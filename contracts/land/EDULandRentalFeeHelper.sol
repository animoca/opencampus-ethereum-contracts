// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IEDULandRentalFeeHelper} from "./interfaces/IEDULandRentalFeeHelper.sol";

/// @title EDULandRentalFeeHelper
/// @notice A helper contract to calulate the rental price of a EDULand based on the total effective rental time.
contract EDULandRentalFeeHelper is IEDULandRentalFeeHelper {
    uint256 public constant POWER_10_18 = 10 ** 18;
    uint256 public constant LN2_WITH_POWER_10_18 = 693147180559945309; // ln(2) * 10^18 for fixed-point arithmetic
    uint256 public constant DEVIDER = 100;
    uint256 public constant STARTING_PRICE = 500;

    /// @inheritdoc IEDULandRentalFeeHelper
    function calulatePrice(uint256 totalEffectiveRentalTime) external pure returns (uint256) {
        // ln(x) + ln(x / DEVIDER) * STARTING_PRICE
        return
            ((Math.log2(totalEffectiveRentalTime) + Math.log2(totalEffectiveRentalTime / DEVIDER)) * STARTING_PRICE * LN2_WITH_POWER_10_18) /
            POWER_10_18;
    }
}
