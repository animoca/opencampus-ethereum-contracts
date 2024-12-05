// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IEDULandPriceHelper} from "./interfaces/IEDULandPriceHelper.sol";

/// @title EDULandPriceHelper
/// @notice A helper contract to calulate the rental price of a EDULand based on the total effective rental time.
contract EDULandPriceHelper is IEDULandPriceHelper {
    /// @inheritdoc IEDULandPriceHelper
    function calculatePrice(uint256 totalEffectiveRentalTime) external pure returns (uint256) {
        return Math.max(5000, Math.log2(totalEffectiveRentalTime / 100) * 300);
    }
}
