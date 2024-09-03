// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IOCP} from "../../../token/OCP/interfaces/IOCP.sol";

contract OCPMock is IOCP {
    mapping(address => uint256) public balances;

    /// @notice Thrown when the holder does not have enough balance
    /// @param holder The given holder.
    /// @param requiredBalance The required balance.
    error InsufficientBalance(address holder, uint256 requiredBalance);

    event Consumed(address indexed holder, bytes32 indexed reasonCode, address operator, uint256 amount);

    constructor(address[] memory allocationAddresses, uint256[] memory allocationAmounts) {
        uint256 length = allocationAddresses.length;
        for (uint256 i = 0; i < length; i++) {
            balances[allocationAddresses[i]] = allocationAmounts[i];
        }
    }

    function consume(address holder, uint256 amount, bytes32 consumeReasonCode) external {
        uint256 balance = balances[holder];
        if (balance < amount) {
            revert InsufficientBalance(holder, amount);
        }

        balances[holder] = balance - amount;

        emit Consumed(holder, consumeReasonCode, msg.sender, amount);
    }
}
