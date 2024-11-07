// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

interface IRevocationRegistry {
    function revokeVC(bytes32 hashedIssuerDid, uint256 vcId, bytes calldata signature) external;

    function batchRevokeVCs(bytes32 hashedIssuerDid, uint256[] calldata vcIds, bytes calldata signature) external;

    function isRevoked(bytes32 hashedIssuerDid, uint256 vcId) external view returns (bool revoked);
}
