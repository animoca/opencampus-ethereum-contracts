// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

contract Rejector {
    error NoThankYou();

    receive() external payable {
        revert NoThankYou();
    }
}
