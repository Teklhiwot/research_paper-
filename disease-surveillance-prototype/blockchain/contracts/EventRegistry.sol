// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract EventRegistry {
    event EventRecorded(string dataHash);

    function recordEvent(string memory dataHash) public {
        emit EventRecorded(dataHash);
    }
}
