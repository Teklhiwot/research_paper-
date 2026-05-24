// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title  AlertLog
 * @notice On-chain registry of surveillance alerts raised by the fog-node.
 *
 * @dev    Only alert identifiers and statistical metadata are stored.
 *         No raw patient data is ever written here.
 *
 *         Role model (mirrors EventRegistry)
 *         ────────────────────────────────────
 *         DEFAULT_ADMIN_ROLE  – deployer; top-level role manager
 *         ADMIN_ROLE          – can revoke alerts
 *         VALIDATOR_ROLE      – fog-node; can raise alerts
 *         REPORTER_ROLE       – reserved for future ACL extensions
 */
contract AlertLog is AccessControl {
    // ─── Roles ─────────────────────────────────────────────────────────────

    bytes32 public constant REPORTER_ROLE  = keccak256("REPORTER_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant ADMIN_ROLE     = keccak256("ADMIN_ROLE");

    // ─── Storage ────────────────────────────────────────────────────────────

    struct Alert {
        bytes32 eventHash;
        string  syndromeCode;
        uint256 count;
        uint256 timestamp;
        string  location;
        bool    active;
    }

    /// @dev alertId (bytes32) → alert record.
    mapping(bytes32 => Alert) private alerts;

    // ─── Events ─────────────────────────────────────────────────────────────

    event AlertRaised(
        bytes32 indexed alertId,
        bytes32 indexed eventHash,
        string          syndromeCode,
        uint256         count
    );

    event AlertRevoked(
        bytes32 indexed alertId
    );

    // ─── Constructor ────────────────────────────────────────────────────────

    constructor(address admin) {
        require(admin != address(0), "AlertLog: zero admin address");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE,         admin);

        // ADMIN_ROLE manages VALIDATOR_ROLE and REPORTER_ROLE.
        _setRoleAdmin(VALIDATOR_ROLE, ADMIN_ROLE);
        _setRoleAdmin(REPORTER_ROLE,  ADMIN_ROLE);

        _grantRole(VALIDATOR_ROLE, admin);
        _grantRole(REPORTER_ROLE,  admin);
    }

    // ─── Write ───────────────────────────────────────────────────────────────

    /**
     * @notice Record a new surveillance alert on-chain.
     *
     * @dev    Callable only by VALIDATOR_ROLE.
     *         Reverts if the alertId has already been registered.
     *
     * @param alertId      Unique identifier for this alert (e.g. keccak256 of fog-node UUID).
     * @param eventHash    SHA-256 hash of the triggering event (bytes32).
     * @param syndromeCode Syndrome code string (e.g. "ILI", "SARI").
     * @param count        Aggregated case count that triggered the alert.
     * @param timestamp    Unix epoch seconds of the alert.
     * @param location     Location identifier string.
     */
    function raiseAlert(
        bytes32         alertId,
        bytes32         eventHash,
        string calldata syndromeCode,
        uint256         count,
        uint256         timestamp,
        string calldata location
    ) external onlyRole(VALIDATOR_ROLE) {
        require(alertId   != bytes32(0),          "AlertLog: zero alertId");
        require(eventHash != bytes32(0),          "AlertLog: zero eventHash");
        require(bytes(syndromeCode).length > 0,   "AlertLog: empty syndromeCode");
        require(bytes(location).length > 0,       "AlertLog: empty location");
        require(timestamp > 0,                    "AlertLog: invalid timestamp");
        require(!alerts[alertId].active,          "AlertLog: alertId already active");

        alerts[alertId] = Alert({
            eventHash:    eventHash,
            syndromeCode: syndromeCode,
            count:        count,
            timestamp:    timestamp,
            location:     location,
            active:       true
        });

        emit AlertRaised(alertId, eventHash, syndromeCode, count);
    }

    /**
     * @notice Revoke an active alert (e.g. after manual review or false-positive).
     *
     * @dev    Callable only by ADMIN_ROLE.
     *         Sets active=false; the record is preserved for audit purposes.
     *         Reverts if the alert does not exist or is already inactive.
     *
     * @param alertId  The alert identifier to revoke.
     */
    function revokeAlert(bytes32 alertId)
        external
        onlyRole(ADMIN_ROLE)
    {
        require(alerts[alertId].active, "AlertLog: alert not active");

        alerts[alertId].active = false;

        emit AlertRevoked(alertId);
    }

    // ─── Read ────────────────────────────────────────────────────────────────

    /**
     * @notice Retrieve the full alert record for a given alertId.
     *
     * @param alertId  The alert identifier to look up.
     * @return         The Alert struct; `active` is false if revoked or not found.
     */
    function getAlert(bytes32 alertId)
        external
        view
        returns (Alert memory)
    {
        return alerts[alertId];
    }
}

