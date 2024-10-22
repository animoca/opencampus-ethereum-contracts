// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/// @notice Emitted when `tokenId` was granted approval to transfer to `destination` by `sender`.
/// @param recipient The address to which transfer was approved for.
/// @param tokenId The tokenId that was approved for transfer.
/// @param sender The account that approved the transfer.
event TransferAllowed(address indexed recipient, uint256 indexed tokenId, address sender);

/// @notice Emitted when `tokenId`'s approval to transfer to `destination` is removed by `sender`.
/// @param recipient The address to which transfer was approved for.
/// @param tokenId The tokenId that was approved for transfer.
/// @param sender The account that approved the transfer.
event AllowedTransferRemoved(address indexed recipient, uint256 indexed tokenId, address sender);

