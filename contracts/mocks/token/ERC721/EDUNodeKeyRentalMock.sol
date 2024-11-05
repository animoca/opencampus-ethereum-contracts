// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {EDUNodeKeyRental} from "../../../token/ERC721/EDUNodeKeyRental.sol";

contract EDUNodeKeyRentalMock is EDUNodeKeyRental {
    bytes public msgData;

    constructor(
        address nodeKeyAddress,
        address pointsAddress,
        uint256 monthlyMaintenceFee_,
        uint256 maxRentalDuration_,
        uint256 maxRentalCountPerCall_,
        IForwarderRegistry forwarderRegistry
    ) EDUNodeKeyRental(nodeKeyAddress, pointsAddress, monthlyMaintenceFee_, maxRentalDuration_, maxRentalCountPerCall_, forwarderRegistry) {
    }

    function __msgData() external view returns (bytes calldata) {
        return _msgData();
    }
}
