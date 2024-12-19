// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

/// @title The interface of EDU Land rental fee helper.
interface IEDULandPriceHelper {
    /// @notice Calulate the EDULand price based on the total ongoing rental time.
    /// @param totalOngoingRentalTime The total effective rental time.
    /// @return The calulated EDULand price.
    function calculatePrice(uint256 totalOngoingRentalTime) external view returns (uint256);
}
