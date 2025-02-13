// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {IEDULandRewards} from "../../land/interfaces/IEDULandRewards.sol";
import {EDULandRewardsKYC} from "../../land/EDULandRewardsKYC.sol";

contract EDULandRewardsKYCMock is EDULandRewardsKYC {
    constructor(
        address messageSigner,
        IEDULandRewards eduLandRewards,
        IForwarderRegistry forwarderRegistry
    ) EDULandRewardsKYC(messageSigner, eduLandRewards, forwarderRegistry) {}

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
