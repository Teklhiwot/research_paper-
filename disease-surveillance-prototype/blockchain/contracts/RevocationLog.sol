// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title  RevocationLog
 * @notice On-chain registry of revoked source credentials.
 *
 * @dev    ADMIN_ROLE holders revoke sources; any caller may check isRevoked().
 *         A revoked source cannot be re-activated on-chain (append-only log).
 */
contract RevocationLog is AccessControl {
    // ─── Roles ─────────────────────────────────────────────────────────────

    bytes32 public constant ADMIN_ROLE     = keccak256("ADMIN_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant REPORTER_ROLE  = keccak256("REPORTER_ROLE");

    // ─── Storage ────────────────────────────────────────────────────────────

    struct Revocation {
        uint256 timestamp;
        string  reason;
        address revokedBy;
    }

    /// @dev source address → revocation record.
    ///      A zero `timestamp` means the address has never been revoked.
    mapping(address => Revocation) private revokedSources;

    // ─── Events ─────────────────────────────────────────────────────────────

    event SourceRevoked(
        address indexed source,
        uint256         timestamp,
        string          reason
    );

    // ─── Constructor ────────────────────────────────────────────────────────

    constructor(address admin) {
        require(admin != address(0), "RevocationLog: zero admin address");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE,         admin);

        _setRoleAdmin(VALIDATOR_ROLE, ADMIN_ROLE);
        _setRoleAdmin(REPORTER_ROLE,  ADMIN_ROLE);

        _grantRole(VALIDATOR_ROLE, admin);
        _grantRole(REPORTER_ROLE,  admin);
    }

    // ─── Write ───────────────────────────────────────────────────────────────

    /**
     * @notice Revoke a source address permanently.
     *
     * @dev    Callable only by ADMIN_ROLE.
     *         Reverts if the source has already been revoked (append-only).
     *
     * @param source  The source address to revoke (e.g. edge device or fog-node).
     * @param reason  Human-readable reason for the revocation.
     */
    function revokeSource(address source, string calldata reason)
        external
        onlyRole(ADMIN_ROLE)
    {
        require(source != address(0),              "RevocationLog: zero source address");
        require(bytes(reason).length > 0,          "RevocationLog: empty reason");
        require(revokedSources[source].timestamp == 0, "RevocationLog: already revoked");

        uint256 ts = block.timestamp;

        revokedSources[source] = Revocation({
            timestamp: ts,
            reason:    reason,
            revokedBy: msg.sender
        });

        emit SourceRevoked(source, ts, reason);
    }

    // ─── Read ────────────────────────────────────────────────────────────────

    /**
     * @notice Check whether a source address has been revoked.
     *
     * @param source  The address to query.
     * @return        True if the address has been revoked, false otherwise.
     */
    function isRevoked(address source) external view returns (bool) {
        return revokedSources[source].timestamp != 0;
    }

    /**
     * @notice Retrieve the full revocation record for a source address.
     *
     * @param source  The address to query.
     * @return        The Revocation struct; `timestamp` is 0 if not revoked.
     */
    function getRevocation(address source)
        external
        view
        returns (Revocation memory)
    {
        return revokedSources[source];
    }
}
