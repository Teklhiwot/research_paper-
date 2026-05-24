"""
blockchain_client.py

Async Web3 client for interacting with on-chain contracts deployed to the
local Hardhat network.

Contracts
─────────
  EventRegistry  – anchor an event SHA-256 hash on-chain
  AlertLog       – raise a surveillance alert on-chain

Nonce management
────────────────
  A single asyncio.Lock serialises every nonce-read → sign → send cycle so
  that concurrent coroutines never collide on nonces, even though the
  underlying JSON-RPC call is async.

Required env vars
─────────────────
  FOG_PRIVATE_KEY          – hex private key for the fog-node signer
  EVENT_REGISTRY_ADDRESS   – deployed EventRegistry contract address
  ALERT_LOG_ADDRESS        – deployed AlertLog contract address

Optional env vars
─────────────────
  HARDHAT_URL              – JSON-RPC endpoint  (default: http://hardhat:8545)
  CHAIN_ID                 – network chain ID   (default: 31337)
  ARTIFACTS_DIR            – path to Hardhat artifacts/contracts directory
  GAS_BUFFER               – gas estimate multiplier (default: 1.2)
  DEPLOYED_ADDRESSES_PATH  – override path to deployed-addresses.json
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Union

from eth_account import Account
from eth_account.signers.local import LocalAccount
from web3 import AsyncWeb3
from web3.exceptions import ContractLogicError

logger = logging.getLogger(__name__)

# ─── Configuration ────────────────────────────────────────────────────────────

_MODULE_DIR = Path(__file__).parent
_REPO_ROOT  = _MODULE_DIR.parent.parent   # fog-node/app → fog-node → repo root

HARDHAT_URL  = os.getenv("HARDHAT_URL", "http://hardhat:8545")
CHAIN_ID     = int(os.getenv("CHAIN_ID", "31337"))
GAS_BUFFER   = float(os.getenv("GAS_BUFFER", "1.2"))

# Artifacts shipped next to the contracts in the Hardhat workspace.
_DEFAULT_ARTIFACTS = _REPO_ROOT / "blockchain" / "artifacts" / "contracts"
ARTIFACTS_DIR      = Path(os.getenv("ARTIFACTS_DIR", str(_DEFAULT_ARTIFACTS)))

_ARTIFACT_REGISTRY = ARTIFACTS_DIR / "EventRegistry.sol" / "EventRegistry.json"
_ARTIFACT_ALERTLOG = ARTIFACTS_DIR / "AlertLog.sol"      / "AlertLog.json"

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _load_abi(artifact_path: Path) -> list:
    """Load the ABI array from a Hardhat 3 artifact JSON file."""
    if not artifact_path.exists():
        raise FileNotFoundError(
            f"ABI artifact not found: {artifact_path}. "
            "Run 'npx hardhat compile' and verify ARTIFACTS_DIR."
        )
    data = json.loads(artifact_path.read_text(encoding="utf-8"))
    return data["abi"]


def _coerce_bytes32(value: Union[str, bytes]) -> bytes:
    """
    Coerce *value* to a 32-byte ``bytes`` object for Solidity bytes32.

    Rules (applied in order):
    1. ``bytes`` of exactly 32 bytes  →  pass-through.
    2. Hex string of 64 chars (optional ``0x`` prefix)  →  direct decode.
    3. Any other string (e.g. UUID, arbitrary ID)  →  SHA-256 digest.
    """
    if isinstance(value, bytes):
        if len(value) != 32:
            raise ValueError(f"Expected 32 bytes, got {len(value)}")
        return value

    stripped = value.removeprefix("0x")
    if len(stripped) == 64:
        try:
            return bytes.fromhex(stripped)
        except ValueError:
            pass  # not valid hex – fall through to sha256

    return hashlib.sha256(value.encode("utf-8")).digest()


# ─── Client ───────────────────────────────────────────────────────────────────

class BlockchainClient:
    """
    Async client for ``EventRegistry`` and ``AlertLog`` on the Hardhat network.

    Usage::

        client = BlockchainClient()
        await client.connect()
        tx = await client.anchor_event_hash(event_hash, source_id, timestamp)
        await client.close()

        # or as an async context manager:
        async with BlockchainClient() as client:
            await client.anchor_event_hash(...)
    """

    def __init__(self) -> None:
        private_key = os.environ.get("FOG_PRIVATE_KEY")
        if not private_key:
            raise EnvironmentError("FOG_PRIVATE_KEY environment variable is required")

        self._account: LocalAccount = Account.from_key(private_key)
        self._w3: AsyncWeb3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(HARDHAT_URL))
        self._nonce_lock: asyncio.Lock = asyncio.Lock()

        self._event_registry_address: str = os.environ.get("EVENT_REGISTRY_ADDRESS", "")
        self._alert_log_address:      str = os.environ.get("ALERT_LOG_ADDRESS", "")

        self._event_registry = None
        self._alert_log      = None

    # ── Connection ─────────────────────────────────────────────────────────

    async def connect(self) -> None:
        """
        Verify connectivity, load ABIs, and bind contract instances.
        Must be called once before any transaction method.
        """
        # Probe the node — raises if unreachable.
        try:
            await self._w3.eth.block_number
        except Exception as exc:
            raise ConnectionError(
                f"Cannot reach Hardhat node at {HARDHAT_URL}: {exc}"
            ) from exc

        # Resolve contract addresses if env vars were not set.
        if not self._event_registry_address or not self._alert_log_address:
            self._load_addresses_from_manifest()

        event_registry_abi = _load_abi(_ARTIFACT_REGISTRY)
        alert_log_abi      = _load_abi(_ARTIFACT_ALERTLOG)

        self._event_registry = self._w3.eth.contract(
            address=AsyncWeb3.to_checksum_address(self._event_registry_address),
            abi=event_registry_abi,
        )
        self._alert_log = self._w3.eth.contract(
            address=AsyncWeb3.to_checksum_address(self._alert_log_address),
            abi=alert_log_abi,
        )

        logger.info(
            "BlockchainClient connected | rpc=%s signer=%s "
            "EventRegistry=%s AlertLog=%s",
            HARDHAT_URL,
            self._account.address,
            self._event_registry_address,
            self._alert_log_address,
        )

    def _load_addresses_from_manifest(self) -> None:
        """
        Fall back to ``deployed-addresses.json`` (written by the deploy script)
        when explicit env vars are absent.
        """
        custom_path = os.environ.get("DEPLOYED_ADDRESSES_PATH")
        candidates = [
            Path(custom_path) if custom_path else None,
            _REPO_ROOT / "blockchain" / "deployed-addresses.json",
            Path("/app/deployed-addresses.json"),
        ]

        for path in candidates:
            if path and path.exists():
                data     = json.loads(path.read_text(encoding="utf-8"))
                contracts = data.get("contracts", {})
                if not self._event_registry_address:
                    self._event_registry_address = contracts.get("EventRegistry", "")
                if not self._alert_log_address:
                    self._alert_log_address = contracts.get("AlertLog", "")
                logger.info("Loaded contract addresses from %s", path)
                return

        raise EnvironmentError(
            "Contract addresses not found. Set EVENT_REGISTRY_ADDRESS and "
            "ALERT_LOG_ADDRESS env vars, or ensure deployed-addresses.json "
            "is accessible at DEPLOYED_ADDRESSES_PATH."
        )

    # ── Transaction core ───────────────────────────────────────────────────

    async def _send(self, contract_fn) -> str:
        """
        Estimate gas, build, sign, and broadcast a transaction.

        The entire nonce-read → estimate → build → sign → send sequence runs
        under ``_nonce_lock`` to prevent nonce collisions when the caller
        dispatches concurrent coroutines.

        Returns the hex transaction hash.
        """
        async with self._nonce_lock:
            nonce = await self._w3.eth.get_transaction_count(
                self._account.address, "pending"
            )

            # Estimate gas; propagate ContractLogicError so callers can
            # distinguish "would revert" from network errors.
            try:
                gas_estimate = await contract_fn.estimate_gas(
                    {"from": self._account.address}
                )
            except ContractLogicError:
                raise
            except Exception as exc:
                raise RuntimeError(f"Gas estimation failed: {exc}") from exc

            tx: dict = await contract_fn.build_transaction(
                {
                    "from":    self._account.address,
                    "nonce":   nonce,
                    "gas":     int(gas_estimate * GAS_BUFFER),
                    "chainId": CHAIN_ID,
                }
            )

            signed   = self._account.sign_transaction(tx)
            tx_hash  = await self._w3.eth.send_raw_transaction(
                signed.rawTransaction
            )

        hex_hash = tx_hash.hex()
        logger.debug("tx sent: %s (nonce=%d gas=%d)", hex_hash, nonce, tx["gas"])
        return hex_hash

    # ── Public API ─────────────────────────────────────────────────────────

    async def anchor_event_hash(
        self,
        event_hash: str,
        source_id:  str,
        timestamp:  int,
    ) -> str:
        """
        Anchor an event SHA-256 hash on-chain via ``EventRegistry.registerEvent``.

        Parameters
        ----------
        event_hash : str
            64-char hex string (SHA-256 of the canonical event JSON).
        source_id : str
            Human-readable source identifier (fog-node or edge-device ID).
        timestamp : int
            Unix epoch seconds of the original event.

        Returns
        -------
        str
            Transaction hash (hex), or ``""`` if the hash was already anchored.
        """
        if self._event_registry is None:
            raise RuntimeError("BlockchainClient.connect() has not been called")

        event_hash_bytes = _coerce_bytes32(event_hash)

        fn = self._event_registry.functions.registerEvent(
            event_hash_bytes,
            source_id,
            timestamp,
        )

        try:
            tx_hash = await self._send(fn)
        except ContractLogicError as exc:
            if "already registered" in str(exc):
                logger.warning(
                    "anchor_event_hash: already registered (idempotent) hash=%s",
                    event_hash[:16] + "...",
                )
                return ""
            raise

        logger.info(
            "anchor_event_hash | hash=%s source=%s ts=%d tx=%s",
            event_hash[:16] + "...",
            source_id,
            timestamp,
            tx_hash,
        )
        return tx_hash

    async def raise_alert(
        self,
        alert_id:  str,
        event_hash: str,
        syndrome:  str,
        count:     int,
        timestamp: int,
        location:  str,
    ) -> str:
        """
        Record a surveillance alert on-chain via ``AlertLog.raiseAlert``.

        Parameters
        ----------
        alert_id : str
            Unique alert identifier – 64-char hex string *or* arbitrary string
            (UUIDs are SHA-256'd to produce a stable bytes32 key).
        event_hash : str
            64-char hex SHA-256 of the triggering event.
        syndrome : str
            Syndrome code (e.g. ``"ILI"``, ``"SARI"``).
        count : int
            Aggregated case count that triggered the alert.
        timestamp : int
            Unix epoch seconds of the alert.
        location : str
            Location identifier string.

        Returns
        -------
        str
            Transaction hash (hex), or ``""`` if the alertId was already active.
        """
        if self._alert_log is None:
            raise RuntimeError("BlockchainClient.connect() has not been called")

        alert_id_bytes   = _coerce_bytes32(alert_id)
        event_hash_bytes = _coerce_bytes32(event_hash)

        fn = self._alert_log.functions.raiseAlert(
            alert_id_bytes,
            event_hash_bytes,
            syndrome,
            count,
            timestamp,
            location,
        )

        try:
            tx_hash = await self._send(fn)
        except ContractLogicError as exc:
            if "already active" in str(exc):
                logger.warning(
                    "raise_alert: alertId already active (idempotent) id=%s",
                    alert_id[:16] + "...",
                )
                return ""
            raise

        logger.info(
            "raise_alert | id=%s syndrome=%s count=%d ts=%d tx=%s",
            alert_id[:16] + "...",
            syndrome,
            count,
            timestamp,
            tx_hash,
        )
        return tx_hash

    # ── Lifecycle ──────────────────────────────────────────────────────────

    async def close(self) -> None:
        """Release the underlying provider session."""
        provider = self._w3.provider
        if hasattr(provider, "disconnect"):
            await provider.disconnect()

    async def __aenter__(self) -> "BlockchainClient":
        await self.connect()
        return self

    async def __aexit__(self, *_) -> None:
        await self.close()
