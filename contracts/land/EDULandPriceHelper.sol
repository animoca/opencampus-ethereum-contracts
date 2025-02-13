// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IEDULandPriceHelper} from "./interfaces/IEDULandPriceHelper.sol";

/// @title EDULandPriceHelper
/// @notice A helper contract to calulate the rental price of a EDULand based on the total effective rental time.
contract EDULandPriceHelper is IEDULandPriceHelper {
    /// @inheritdoc IEDULandPriceHelper
    function calculatePrice(uint256 totalOngoingRentalTime) external pure returns (uint256) {
        return Math.max(3000, Math.log2(totalOngoingRentalTime / 125000000) * 1250);
    }
}
