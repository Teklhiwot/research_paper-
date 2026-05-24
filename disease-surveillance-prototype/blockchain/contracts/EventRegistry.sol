// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title  EventRegistry
 * @notice Immutable on-chain registry of surveillance-event SHA-256 hashes.
 *
 * @dev    Only SHA-256 hashes and minimal metadata are written on-chain.
 *         Raw patient data is NEVER stored here (per architecture constraints).
 *
 *         Role model
 *         ──────────
 *         DEFAULT_ADMIN_ROLE  – deployer; can grant/revoke all roles
 *         ADMIN_ROLE          – named alias for operational administration
 *         VALIDATOR_ROLE      – fog-node / storage service; may register events
 *         REPORTER_ROLE       – edge client; reserved for future ACL extensions
 *
 *         ADMIN_ROLE is set as the role-admin for VALIDATOR_ROLE and
 *         REPORTER_ROLE so that ADMIN_ROLE holders can manage those roles
 *         without requiring DEFAULT_ADMIN_ROLE.
 */
contract EventRegistry is AccessControl {
    // ─── Roles ─────────────────────────────────────────────────────────────

    bytes32 public constant REPORTER_ROLE  = keccak256("REPORTER_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant ADMIN_ROLE     = keccak256("ADMIN_ROLE");

    // ─── Storage ────────────────────────────────────────────────────────────

    /**
     * @dev Minimal metadata anchored alongside the event hash.
     *      `exists` is the sentinel for "hash has been registered".
     *      Storing `string sourceId` off the mapping key keeps the struct
     *      self-describing while avoiding any raw clinical content on-chain.
     */
    struct EventCommit {
        string  sourceId;
        uint256 timestamp;
        address submitter;
        bool    exists;
    }

    /// @dev  eventHash (bytes32 SHA-256) → commitment record.
    ///       Private: all access goes through getEvent() to keep the public
    ///       API explicit and avoid the compiler generating a tuple-returning
    ///       auto-getter that does not return the struct type directly.
    mapping(bytes32 => EventCommit) private eventCommits;

    // ─── Events ─────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when a new event hash is anchored on-chain.
     * @param eventHash  SHA-256 hash of the canonical event JSON.
     * @param sourceId   Off-chain source identifier (fog-node / edge device).
     * @param timestamp  Unix epoch timestamp of the original event (seconds).
     * @param submitter  Address of the VALIDATOR_ROLE caller.
     */
    event EventRegistered(
        bytes32 indexed eventHash,
        string          sourceId,
        uint256         timestamp,
        address indexed submitter
    );

    // ─── Constructor ────────────────────────────────────────────────────────

    /**
     * @param admin Address that receives DEFAULT_ADMIN_ROLE and ADMIN_ROLE
     *              on deployment (typically the deployer EOA or a multi-sig).
     */
    constructor(address admin) {
        require(admin != address(0), "EventRegistry: zero admin address");

        // Grant top-level admin roles to the deployer.
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE,         admin);

        // Allow ADMIN_ROLE to manage VALIDATOR_ROLE and REPORTER_ROLE
        // so operational key rotation does not require DEFAULT_ADMIN_ROLE.
        _setRoleAdmin(VALIDATOR_ROLE, ADMIN_ROLE);
        _setRoleAdmin(REPORTER_ROLE,  ADMIN_ROLE);

        // Grant the deployer VALIDATOR_ROLE for immediate use in tests/scripts.
        _grantRole(VALIDATOR_ROLE, admin);
        _grantRole(REPORTER_ROLE,  admin);
    }

    // ─── Write ───────────────────────────────────────────────────────────────

    /**
     * @notice Anchor a surveillance-event hash on-chain.
     *
     * @dev    Callable only by accounts holding VALIDATOR_ROLE.
     *         Reverts on duplicate registration to preserve the immutability
     *         guarantee: a hash, once anchored, cannot be overwritten.
     *
     * @param eventHash  bytes32 SHA-256 hash of the canonical event JSON.
     *                   Must be non-zero and not previously registered.
     * @param sourceId   Human-readable source identifier (≤ 256 bytes).
     *                   Stored only as metadata — never raw patient data.
     * @param timestamp  Unix epoch seconds of the original event.
     */
    function registerEvent(
        bytes32         eventHash,
        string calldata sourceId,
        uint256         timestamp
    ) external onlyRole(VALIDATOR_ROLE) {
        require(eventHash != bytes32(0),          "EventRegistry: zero hash");
        require(bytes(sourceId).length > 0,       "EventRegistry: empty sourceId");
        require(bytes(sourceId).length <= 256,    "EventRegistry: sourceId too long");
        require(timestamp > 0,                    "EventRegistry: invalid timestamp");
        require(!eventCommits[eventHash].exists,  "EventRegistry: already registered");

        eventCommits[eventHash] = EventCommit({
            sourceId:  sourceId,
            timestamp: timestamp,
            submitter: msg.sender,
            exists:    true
        });

        emit EventRegistered(eventHash, sourceId, timestamp, msg.sender);
    }

    // ─── Read ────────────────────────────────────────────────────────────────

    /**
     * @notice Retrieve the on-chain commitment for a given event hash.
     *
     * @param eventHash  SHA-256 hash to look up.
     * @return commit    The EventCommit struct.
     *                   `commit.exists` is false when the hash is not found.
     */
    function getEvent(bytes32 eventHash)
        external
        view
        returns (EventCommit memory commit)
    {
        return eventCommits[eventHash];
    }
}

