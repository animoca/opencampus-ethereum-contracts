// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {OCPointMerkleClaim} from "../../payment/OCPointMerkleClaim.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";

contract OCPointMerkleClaimMock is OCPointMerkleClaim {
    constructor(address ecpContractAddress, IForwarderRegistry forwarderRegistry) OCPointMerkleClaim(ecpContractAddress, forwarderRegistry) {}

    /// @notice Internal function to access the current msg.sender.
    /// @return The current msg.sender value.
    function __msgSender() external view returns (address) {
        return _msgSender();
    }

    /// @notice Internal function to access the current msg.data.
    /// @return The current msg.data value.
    function __msgData() external view returns (bytes calldata) {
        return _msgData();
    }
}
