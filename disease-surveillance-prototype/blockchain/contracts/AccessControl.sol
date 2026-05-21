// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AccessControl {
    mapping(address => bool) private authorized;
    address public owner;

    constructor() {
        owner = msg.sender;
        authorized[msg.sender] = true;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can perform this action");
        _;
    }

    modifier onlyAuthorized() {
        require(authorized[msg.sender], "Not authorized");
        _;
    }

    function setAuthorized(address account, bool value) public onlyOwner {
        authorized[account] = value;
    }

    function isAuthorized(address account) public view returns (bool) {
        return authorized[account];
    }
}
