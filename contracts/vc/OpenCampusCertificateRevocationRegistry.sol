// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {IIssuersDIDRegistry} from "./interfaces/IIssuersDIDRegistry.sol";
import {IRevocationRegistry} from "./interfaces/IRevocationRegistry.sol";
import {VcRevoked} from "./events/RevocationRegistryEvents.sol";

/// @title OpenCampusCertificateRevocationRegistry.
/// @notice A registry storing the revocation of VCs.
contract OpenCampusCertificateRevocationRegistry is IRevocationRegistry, ContractOwnership {
    IIssuersDIDRegistry internal immutable DID_REGISTRY;

    mapping(bytes32 => mapping(uint256 => address)) public revocations;
    uint256 public currentNonce;

    /// @notice Thrown when the signature is invalid for the NFT payload.
    error InvalidSignature();

    /// @notice Thrown when the nonce given is invalid.
    error InvalidNonce();

    /// @notice Thrown when the recovered issuer and the passed in issuerDid is not allowed in the DIDRegistry
    error InvalidIssuer();

    constructor(IIssuersDIDRegistry didRegistry) ContractOwnership(msg.sender) {
        DID_REGISTRY = didRegistry;
    }

    /// @param hashedIssuerDid keccak256 hashed issuer Did.
    /// @param vcId the VC ID to be revoked.
    function isRevoked(bytes32 hashedIssuerDid, uint256 vcId) external view returns (bool revoked) {
        // Use-Cases
        // 1. issuer addr/did valid & revoked => revoker valid address, DIDRegistry allowed => returns true
        // 2. issuer addr/did valid when revoked, invalidated later in DIDRegistry => revoker valid address, DIDRegistry disallowed => returns false
        // 3. vcId never revoked => revoker address zero => DIDRegistry disallowed => return false
        address revoker = revocations[hashedIssuerDid][vcId];
        return DID_REGISTRY.issuers(hashedIssuerDid, revoker);
    }

    /// @dev Reverts with `InvalidNonce` when the given nonce is invalid.
    /// @dev Reverts with `InvalidIssuer` when the recovered issuer is invalid.
    /// @dev Emits a `VcRevoked` event when a vc is revoked
    /// @param hashedIssuerDid keccak256 hashed issuer Did.
    /// @param vcId the VC ID to be revoked.
    /// @param nonce the nonce that should match `currentNonce` in order to be valid.
    /// @param signature ECDSA signature of the combined value (`hashedIssuerDid`, `vcId`, `nonce`).
    function revokeVC(bytes32 hashedIssuerDid, uint256 vcId, uint256 nonce, bytes calldata signature) external {
        if (nonce != currentNonce) {
            revert InvalidNonce();
        }

        if (signature.length != 65) revert InvalidSignature();

        uint8 v;
        bytes32 r;
        bytes32 s;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := calldataload(add(signature.offset, 0x21))
        }

        // Use the native ecrecover provided by the EVM
        address signer = ecrecover(keccak256(abi.encode(hashedIssuerDid, vcId, nonce)), v, r, s);
        if (DID_REGISTRY.issuers(hashedIssuerDid, signer)) {
            revocations[hashedIssuerDid][vcId] = signer;
            emit VcRevoked(hashedIssuerDid, signer, vcId);
            ++currentNonce;
        } else {
            revert InvalidIssuer();
        }
    }

    /// @dev Reverts with `InvalidNonce` when the given nonce is invalid.
    /// @dev Reverts with `InvalidIssuer` when the recovered issuer is invalid.
    /// @dev Emits a `VcRevoked` event when a vc is revoked
    /// @param hashedIssuerDid keccak256 hashed issuer Did.
    /// @param vcIds the list of VC IDs to be revoked.
    /// @param nonce the nonce that should match `currentNonce` in order to be valid.
    /// @param signature ECDSA signature of the combined value (`hashedIssuerDid`, `vcId`, `nonce`).
    function batchRevokeVCs(bytes32 hashedIssuerDid, uint256[] calldata vcIds, uint256 nonce, bytes calldata signature) external {
        if (nonce != currentNonce) {
            revert InvalidNonce();
        }

        if (signature.length != 65) revert InvalidSignature();

        uint8 v;
        bytes32 r;
        bytes32 s;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := calldataload(add(signature.offset, 0x21))
        }

        // Use the native ecrecover provided by the EVM
        address signer = ecrecover(keccak256(abi.encode(hashedIssuerDid, vcIds, nonce)), v, r, s);
        if (DID_REGISTRY.issuers(hashedIssuerDid, signer)) {
            for (uint256 i; i < vcIds.length; i++) {
                revocations[hashedIssuerDid][vcIds[i]] = signer;
                emit VcRevoked(hashedIssuerDid, signer, vcIds[i]);
            }
            ++currentNonce;
        } else {
            revert InvalidIssuer();
        }
    }
}
