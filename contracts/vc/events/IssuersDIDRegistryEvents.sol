// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

/// @notice Emitted when `hashedDid` is added to the registry by `operator`.
/// @param hashedDid The keccak256 hashed did for issuer that was added.
/// @param issuerAddress The name of the issuer for information
/// @param operator The account add the issuer.
event IssuerAdded(bytes32 indexed hashedDid, address indexed issuerAddress, address operator);

/// @notice Emitted when `hashedDid` is removed from the registry by `operator`.
/// @param hashedDid The keccak256 did for issuer that was removed.
/// @param issuerAddress The name of the issuer for information
/// @param operator The account removed the issuer.
event IssuerRemoved(bytes32 indexed hashedDid, address indexed issuerAddress, address operator);

