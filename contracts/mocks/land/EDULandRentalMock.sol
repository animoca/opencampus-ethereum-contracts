// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {EDULandRental} from "../../land/EDULandRental.sol";

contract EDULandRentalMock is EDULandRental {
    bytes public msgData;

    constructor(
        address nodeKeyAddress,
        address pointsAddress,
        address rentalFeeHelperAddress,
        uint256 maintenceFee_,
        uint256 maintenanceFeeDenominator_,
        uint256 minRentalDuration_,
        uint256 maxRentalDuration_,
        uint256 maxRentalCountPerCall_,
        uint256 maxTokenSupply_,
        IForwarderRegistry forwarderRegistry
    )
        EDULandRental(
            nodeKeyAddress,
            pointsAddress,
            rentalFeeHelperAddress,
            maintenceFee_,
            maintenanceFeeDenominator_,
            minRentalDuration_,
            maxRentalDuration_,
            maxRentalCountPerCall_,
            maxTokenSupply_,
            forwarderRegistry
        )
    {}

    function __msgData() external view returns (bytes calldata) {
        return _msgData();
    }
}
