// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

interface IOCP {
    function consume(address holder, uint256 amount, bytes32 consumeReasonCode) external;
}
