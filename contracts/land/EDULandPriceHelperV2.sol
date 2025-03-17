// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IEDULandPriceHelper} from "./interfaces/IEDULandPriceHelper.sol";

/// @title EDULandPriceHelperV2
/// @notice A helper contract to calculate the rental price of a EDULand based on the total effective rental time.
contract EDULandPriceHelperV2 is IEDULandPriceHelper {
    /// @inheritdoc IEDULandPriceHelper
    function calculatePrice(uint256 totalOngoingRentalTime) external pure returns (uint256) {
        return Math.max(1000, Math.log2(totalOngoingRentalTime / 15000000000) * 17000);
    }
}
