// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AlertLog {
    event AlertRaised(string message);

    function raiseAlert(string memory message) public {
        emit AlertRaised(message);
    }
}
