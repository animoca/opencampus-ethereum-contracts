// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

// other imports
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
// animoca imports
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {IIssuersDIDRegistry} from "./interfaces/IIssuersDIDRegistry.sol";
import {IRevocationRegistry} from "./interfaces/IRevocationRegistry.sol";
import {VcRevoked} from "./events/RevocationRegistryEvents.sol";

/// @title OpenCampusCertificateRevocationRegistry.
/// @notice A registry storing the revocation of VCs.
contract OpenCampusCertificateRevocationRegistry is IRevocationRegistry, ContractOwnership {
    using ECDSA for bytes32;

    bytes32 private constant EIP712_DOMAIN_NAME = keccak256("RevocationRegistryV1");
    bytes32 private constant REVOKE_TYPEHASH = keccak256("revokeVC(bytes32 hashedIssuerDid,uint256 vcId)");
    bytes32 private constant BATCH_REVOKE_TYPEHASH = keccak256("batchRevokeVCs(bytes32 hashedIssuerDid,uint256[] vcIds)");

    IIssuersDIDRegistry internal immutable DID_REGISTRY;
    bytes32 private immutable DOMAIN_SEPARATOR;

    mapping(bytes32 => mapping(uint256 => address)) public revocations;

    /// @notice Thrown when the recovered issuer and the passed in issuerDid is not allowed in the DIDRegistry
    error InvalidIssuer();

    constructor(IIssuersDIDRegistry didRegistry) ContractOwnership(msg.sender) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        DID_REGISTRY = didRegistry;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"), EIP712_DOMAIN_NAME, chainId, address(this))
        );
    }

    /// @param hashedIssuerDid keccak256 hashed issuer Did.
    /// @param vcId the VC ID to be revoked.
    /// @return revoked Returns true if the given vcId has been revoked by a valid issuer
    function isRevoked(bytes32 hashedIssuerDid, uint256 vcId) external view returns (bool revoked) {
        // Use-Cases
        // 1. issuer addr/did valid & revoked => revoker valid address, DIDRegistry allowed => returns true
        // 2. issuer addr/did valid when revoked, invalidated later in DIDRegistry => revoker valid address, DIDRegistry disallowed => returns false
        // 3. vcId never revoked => revoker address zero => DIDRegistry disallowed => return false
        address revoker = revocations[hashedIssuerDid][vcId];
        return DID_REGISTRY.issuers(hashedIssuerDid, revoker);
    }

    /// @dev Reverts with `InvalidIssuer` when the recovered issuer is invalid.
    /// @dev Emits a `VcRevoked` event when a vc is revoked
    /// @param hashedIssuerDid keccak256 hashed issuer Did.
    /// @param vcId the VC ID to be revoked.
    /// @param signature EIP712 Signature for values `hashedIssuerDid` and `vcId`
    function revokeVC(bytes32 hashedIssuerDid, uint256 vcId, bytes calldata signature) external {
        bytes memory data = abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, keccak256(abi.encode(REVOKE_TYPEHASH, hashedIssuerDid, vcId)));
        address signer = keccak256(data).recover(signature);

        if (DID_REGISTRY.issuers(hashedIssuerDid, signer)) {
            revocations[hashedIssuerDid][vcId] = signer;
            emit VcRevoked(hashedIssuerDid, signer, vcId);
        } else {
            revert InvalidIssuer();
        }
    }

    /// @dev Reverts with `InvalidNonce` when the given nonce is invalid.
    /// @dev Reverts with `InvalidIssuer` when the recovered issuer is invalid.
    /// @dev Emits a `VcRevoked` event when a vc is revoked
    /// @param hashedIssuerDid keccak256 hashed issuer Did.
    /// @param vcIds the list of VC IDs to be revoked.
    /// @param signature EIP712 Signature for values `hashedIssuerDid` and `vcIds`
    function batchRevokeVCs(bytes32 hashedIssuerDid, uint256[] calldata vcIds, bytes calldata signature) external {
        bytes memory data = abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            // https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md#definition-of-encodedata
            // array type `vcIds` are encoded differently from non-array type data
            keccak256(abi.encode(BATCH_REVOKE_TYPEHASH, hashedIssuerDid, keccak256(abi.encodePacked(vcIds))))
        );
        address signer = keccak256(data).recover(signature);

        if (DID_REGISTRY.issuers(hashedIssuerDid, signer)) {
            for (uint256 i; i < vcIds.length; i++) {
                revocations[hashedIssuerDid][vcIds[i]] = signer;
                emit VcRevoked(hashedIssuerDid, signer, vcIds[i]);
            }
        } else {
            revert InvalidIssuer();
        }
    }
}
