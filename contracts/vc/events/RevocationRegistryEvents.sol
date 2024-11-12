// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/// @notice Emitted when `caller` successfully revokes `vcId`.
/// @param hashedIssuerDid the hashed Did for the issuer
/// @param caller address of caller that invoked the revocation.
/// @param vcId The Id for the VC revoked.
event VcRevoked(bytes32 indexed hashedIssuerDid, address caller, uint256 indexed vcId);

