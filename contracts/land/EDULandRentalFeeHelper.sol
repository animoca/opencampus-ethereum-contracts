// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IEDULandRentalFeeHelper} from "./interfaces/IEDULandRentalFeeHelper.sol";

/// @title EDULandRentalFeeHelper
/// @notice A helper contract to calulate the rental price of a EDULand based on the total effective rental time.
contract EDULandRentalFeeHelper is IEDULandRentalFeeHelper {
    /// @inheritdoc IEDULandRentalFeeHelper
    function calulatePrice(uint256 totalEffectiveRentalTime) external pure returns (uint256) {
        return Math.max(5000, Math.log2(totalEffectiveRentalTime / 100) * 300);
    }
}
