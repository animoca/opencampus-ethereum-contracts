// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IEDULandPriceHelper} from "./interfaces/IEDULandPriceHelper.sol";

/// @title EDULandPriceHelperV2
/// @notice A helper contract to return the EDULand rental price.
contract EDULandPriceHelperV2 is IEDULandPriceHelper {
    /// @inheritdoc IEDULandPriceHelper
    function calculatePrice(uint256) external pure returns (uint256) {
        return 400;
    }
}
