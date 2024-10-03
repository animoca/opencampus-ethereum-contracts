// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/// @title IAllowedIssuersRegistry
/// @notice Interface for registry to store allowed issuers for VCs to mint NFT VCs
interface IIssuersDIDRegistry {
    function isIssuerAllowed(bytes32 hashedDid, address issuerAddress) external view returns (bool allowed);

    function isIssuerAllowedByDid(string calldata did, address issuerAddress) external view returns (bool allowed);
}
