// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

/// @title The interface of EDU Land rental fee helper.
interface IEDULandPriceHelper {
    /// @notice Calulate the EDULand price based on the total effective rental time.
    /// @param totalEffectiveRentalTime The total effective rental time.
    /// @return The calulated EDULand price.
    function calculatePrice(uint256 totalEffectiveRentalTime) external pure returns (uint256);
}
