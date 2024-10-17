// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.22;

interface IPoints {
    function deposit(address holder, uint256 amount, bytes32 depositReasonCode) external;
}
