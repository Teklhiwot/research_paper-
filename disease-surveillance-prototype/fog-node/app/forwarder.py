"""
forwarder.py

Post-processing event router for the fog-node.

After deduplication, aggregation, and anomaly detection complete, every
accepted event is handed to ``route_event``.  The routing decision is:

  Anomaly detected
  ────────────────
    A. Publish to ``surveillance.alerts``   routing key  ``alert.raised``
       Payload: merged dict of the alert object + the original event.
    B. POST event SHA-256 hash to blockchain service  (fire-and-forget,
       fail-open — an HTTP error never blocks the consumer pipeline).

  Normal event
  ────────────
    A. Publish to ``surveillance.storage``  routing key  ``report.store``
       Payload: the canonical event dict.
    B. Append the event's SHA-256 hash to a Redis rolling buffer (last
       ``BATCH_SIZE`` hashes, capped with LTRIM).
    C. Every ``BATCH_SIZE`` (default 50) normal events, compute a
       Merkle-like batch hash and publish to ``surveillance.batch``
       routing key  ``batch.commit``.  The batch hash is also anchored
       on the blockchain.

Merkle-like batch hash
──────────────────────
  root = SHA-256( "".join( sorted( sha256(event_i) for i in window ) ) )
  Sorting guarantees the root is deterministic regardless of arrival order.

Blockchain anchoring
────────────────────
  POST {BLOCKCHAIN_URL}/anchor
  body: { eventId, hash, timestamp, type: "event" | "batch" }

  Per architecture constraints, ONLY SHA-256 hashes and metadata are
  transmitted – never raw patient data.

Exchange topology
─────────────────
  All three downstream exchanges are topic + durable.  They are declared
  once per (re)connection via ``setup_exchanges(channel)`` which is called
  from ``consumers._setup_topology``.  Results are cached module-level so
  ``route_event`` can publish without a round-trip per message.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import aio_pika
import aio_pika.abc
import httpx
import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

# ─── Configuration ────────────────────────────────────────────────────────────

REDIS_URL: str      = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
BLOCKCHAIN_URL: str = os.getenv('BLOCKCHAIN_URL', 'http://localhost:3001')
BATCH_SIZE: int     = int(os.getenv('BATCH_SIZE', '50'))

# ─── Exchange / routing-key constants ─────────────────────────────────────────

ALERTS_EXCHANGE:  str = 'surveillance.alerts'
STORAGE_EXCHANGE: str = 'surveillance.storage'
BATCH_EXCHANGE:   str = 'surveillance.batch'

ALERTS_KEY:  str = 'alert.raised'
STORAGE_KEY: str = 'report.store'
BATCH_KEY:   str = 'batch.commit'

# ─── Redis key names ──────────────────────────────────────────────────────────

_BATCH_COUNTER_KEY: str = 'batch:event_counter'
_BATCH_HASHES_KEY:  str = 'batch:event_hashes'

# ─── Module-level resource caches ─────────────────────────────────────────────

# Exchange objects populated by setup_exchanges(); replaced on every reconnect.
_exchanges: dict[str, aio_pika.abc.AbstractExchange] = {}

_redis_client: Optional[aioredis.Redis] = None
_http_client:  Optional[httpx.AsyncClient] = None


def _get_redis() -> aioredis.Redis:
    global _redis_client  # noqa: PLW0603
    if _redis_client is None:
        _redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis_client


def _get_http() -> httpx.AsyncClient:
    global _http_client  # noqa: PLW0603
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(float(os.getenv('BLOCKCHAIN_TIMEOUT', '5.0')))
        )
    return _http_client


# ─── Topology setup (called once per connection from consumers.py) ────────────


async def setup_exchanges(channel: aio_pika.abc.AbstractChannel) -> None:
    """
    Idempotently declare all three downstream topic exchanges and cache them.

    Must be called from ``consumers._setup_topology`` after every
    (re)connection so the cached exchange objects stay valid.
    """
    for name in (ALERTS_EXCHANGE, STORAGE_EXCHANGE, BATCH_EXCHANGE):
        _exchanges[name] = await channel.declare_exchange(
            name, aio_pika.ExchangeType.TOPIC, durable=True
        )
    logger.debug('[forwarder] Exchanges ready: %s', list(_exchanges))


# ─── Hash helpers ─────────────────────────────────────────────────────────────


def _event_hash(event: dict) -> str:
    """SHA-256 of the canonical (sorted-keys, compact) JSON of *event*."""
    canonical = json.dumps(event, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _merkle_root(hashes: list[str]) -> str:
    """
    Merkle-like root over *hashes*.

    Computed as SHA-256 of the sorted hex strings concatenated.  Sorting
    ensures the root is independent of message-arrival order.
    """
    return hashlib.sha256(''.join(sorted(hashes)).encode()).hexdigest()


# ─── Internal helpers ─────────────────────────────────────────────────────────


async def _publish(exchange_name: str, routing_key: str, payload: dict) -> None:
    """Publish *payload* as a persistent JSON message to *exchange_name*."""
    exchange = _exchanges.get(exchange_name)
    if exchange is None:
        logger.error(
            '[forwarder] Exchange %r not initialised – skipping publish to %s',
            exchange_name, routing_key,
        )
        return
    await exchange.publish(
        aio_pika.Message(
            body=json.dumps(payload).encode(),
            content_type='application/json',
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        ),
        routing_key=routing_key,
    )


async def _anchor(
    event_id: str,
    hash_hex: str,
    timestamp: str,
    anchor_type: str = 'event',
) -> None:
    """
    POST *hash_hex* and metadata to the blockchain anchoring service.

    Fire-and-forget: any HTTP error is logged but never raises, so a
    blockchain outage cannot stall the consumer pipeline.
    Only the SHA-256 hash and metadata are sent – never raw event data.
    """
    body = {
        'eventId':   event_id,
        'hash':      hash_hex,
        'timestamp': timestamp,
        'type':      anchor_type,
    }
    try:
        resp = await _get_http().post(f'{BLOCKCHAIN_URL}/anchor', json=body)
        resp.raise_for_status()
        logger.info(
            '[forwarder] Anchored %s %s (hash=%.12s…)', anchor_type, event_id, hash_hex
        )
    except httpx.HTTPError as exc:
        logger.error(
            '[forwarder] Blockchain anchor failed (%s %s): %s',
            anchor_type, event_id, exc,
        )


async def _update_batch_buffer(
    event_id: str,
    hash_hex: str,
    now_iso: str,
) -> None:
    """
    Maintain the rolling batch buffer and emit a commitment every BATCH_SIZE events.

    Redis operations (single pipeline round-trip)
    ─────────────────────────────────────────────
      RPUSH  batch:event_hashes  hash_hex      → append
      LTRIM  batch:event_hashes  -BATCH_SIZE  -1  → cap list length
      INCR   batch:event_counter               → atomic sequence number

    When the counter reaches a multiple of BATCH_SIZE:
      1. LRANGE returns the current window (up to BATCH_SIZE hashes).
      2. Compute Merkle-like root.
      3. Publish batch commitment to ``surveillance.batch``.
      4. Anchor the batch root on the blockchain (fire-and-forget).

    Note: in a single-consumer deployment the INCR modulo check is exact.
    In multi-consumer deployments each consumer maintains its own rolling
    window; batch commits may overlap, which is safe for a prototype.
    """
    redis = _get_redis()
    try:
        async with redis.pipeline(transaction=False) as pipe:
            pipe.rpush(_BATCH_HASHES_KEY, hash_hex)
            pipe.ltrim(_BATCH_HASHES_KEY, -BATCH_SIZE, -1)
            pipe.incr(_BATCH_COUNTER_KEY)
            results = await pipe.execute()

        counter: int = results[2]   # value returned by INCR

        if counter % BATCH_SIZE == 0:
            hashes: list[str] = await redis.lrange(_BATCH_HASHES_KEY, 0, -1)
            if not hashes:
                logger.warning('[forwarder] Batch counter hit %d but hash list is empty', counter)
                return

            root     = _merkle_root(hashes)
            batch_id = str(uuid.uuid4())
            commit   = {
                'batchId':    batch_id,
                'batchHash':  root,
                'eventCount': len(hashes),
                'timestamp':  now_iso,
            }

            await _publish(BATCH_EXCHANGE, BATCH_KEY, commit)
            logger.info(
                '[forwarder] Batch commitment %s published (n=%d root=%.12s…)',
                batch_id, len(hashes), root,
            )

            # Anchor the batch root on-chain (only hash + metadata)
            await _anchor(batch_id, root, now_iso, anchor_type='batch')

    except aioredis.RedisError as exc:
        logger.error(
            '[forwarder] Redis error updating batch buffer for event %s: %s',
            event_id, exc,
        )


# ─── Public API ───────────────────────────────────────────────────────────────


async def route_event(event: dict, alert: Optional[dict]) -> None:
    """
    Route a validated, deduplicated event to the appropriate downstream exchange.

    Parameters
    ----------
    event:
        Canonical event dict (``SurveillanceEvent.model_dump()``).
    alert:
        Alert dict returned by ``anomaly.check_anomaly``, or ``None``
        when the event is within normal bounds.
    """
    now_iso  = datetime.now(timezone.utc).isoformat()
    event_id = event.get('eventId', str(uuid.uuid4()))
    hash_hex = _event_hash(event)

    if alert is not None:
        # ── Path A: anomaly detected ──────────────────────────────────────────
        await _publish(
            ALERTS_EXCHANGE,
            ALERTS_KEY,
            {**alert, 'event': event},
        )
        logger.info(
            '[forwarder] Alert %s → %s (severity=%s)',
            alert.get('alertId'), ALERTS_EXCHANGE, alert.get('severity'),
        )

        # Anchor the anomalous event hash on-chain (fail-open)
        await _anchor(
            event_id,
            hash_hex,
            event.get('timestamp', now_iso),
            anchor_type='event',
        )

    else:
        # ── Path B: normal event ──────────────────────────────────────────────
        await _publish(STORAGE_EXCHANGE, STORAGE_KEY, event)
        logger.debug('[forwarder] Event %s → %s', event_id, STORAGE_EXCHANGE)

        # ── Path C: rolling batch commitment ──────────────────────────────────
        await _update_batch_buffer(event_id, hash_hex, now_iso)
