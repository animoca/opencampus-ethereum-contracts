// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

// other imports
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {ContractOwnershipStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/ContractOwnershipStorage.sol";
import {IIssuersDIDRegistry} from "./interfaces/IIssuersDIDRegistry.sol";
import {IRevocationRegistry} from "./interfaces/IRevocationRegistry.sol";
import {CertificateNFTv1MetaData} from "./libraries/CertificateNFTv1MetaData.sol";
import {OpenCampusCertificateNFTv1} from "./OpenCampusCertificateNFTv1.sol";

contract OpenCampusCertificateNFTMinter is ContractOwnership {
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;
    using ECDSA for bytes32;

    IIssuersDIDRegistry internal immutable DID_REGISTRY;
    OpenCampusCertificateNFTv1 internal immutable NFT_V1;

    IRevocationRegistry internal _revocationRegistry;
    /// @notice Thrown when the signature is invalid for the NFT payload.
    error InvalidSignature();

    /// @notice Thrown when the issuer is not one of the allowed issuers.
    error IssuerNotAllowed();

    /// @notice Thrown when the VC has been revoked.
    error VcRevoked();

    constructor(
        IIssuersDIDRegistry didRegistry,
        OpenCampusCertificateNFTv1 nftv1,
        IRevocationRegistry revocationRegistry
    ) ContractOwnership(msg.sender) {
        DID_REGISTRY = didRegistry;
        NFT_V1 = nftv1;
        _revocationRegistry = revocationRegistry;
    }

    /// @param revocationRegistry The address of the Revocation Registry contract.
    function setRevocationRegistry(IRevocationRegistry revocationRegistry) external {
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());
        _revocationRegistry = revocationRegistry;
    }

    /// @dev Reverts with `VcRevoked` error if the token being minted has been revoked.
    /// @dev Reverts with `IssuerNotAllowed` error if recovered issuer is not valid in the DIDRegistry.
    /// @dev Reverts with `InvalidSignature` error if the signature is not 65 bytes in length.
    /// @dev signature is ECDSA signature for (to, tokenId, metadata).
    /// @dev signature is a 65 bytes raw signature without compacting.
    /// @param to The address to which `tokenId` would be minted to.
    /// @param tokenId The id of the token to be minted.
    /// @param metadata On-chain metadata for the NFT.
    /// @param signature The ECDSA signature for the payload (`to`,`tokenId`,`metadata`).
    function mint(address to, uint256 tokenId, CertificateNFTv1MetaData.MetaData calldata metadata, bytes calldata signature) external {
        // // recover the signer
        // if (signature.length != 65) revert InvalidSignature();

        // uint8 v;
        // bytes32 r;
        // bytes32 s;
        // assembly {
        //     r := calldataload(signature.offset)
        //     s := calldataload(add(signature.offset, 0x20))
        //     v := calldataload(add(signature.offset, 0x21))
        // }

        // // Use the native ecrecover provided by the EVM
        // address signer = ecrecover(keccak256(abi.encode(to, tokenId, metadata)), v, r, s);
        address signer = keccak256(abi.encode(to, tokenId, metadata)).recover(signature);

        bytes32 hashedDid = keccak256(abi.encodePacked(metadata.issuerDid));

        if (DID_REGISTRY.issuers(hashedDid, signer)) {
            if (_revocationRegistry.isRevoked(hashedDid, tokenId)) {
                revert VcRevoked();
            }
            NFT_V1.mint(to, tokenId, metadata);
        } else {
            revert IssuerNotAllowed();
        }
    }
}
