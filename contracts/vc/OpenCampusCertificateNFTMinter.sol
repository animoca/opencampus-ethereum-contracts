// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {AccessControl} from "@animoca/ethereum-contracts/contracts/access/AccessControl.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {IIssuersDIDRegistry} from "./interfaces/IIssuersDIDRegistry.sol";
import {CertificateNFTv1MetaData} from "./libraries/CertificateNFTv1MetaData.sol";
import {OpenCampusCertificateNFTv1} from "./OpenCampusCertificateNFTv1.sol";

contract OpenCampusCertificateNFTMinter is AccessControl {
    IIssuersDIDRegistry internal immutable DID_REGISTRY;
    OpenCampusCertificateNFTv1 internal immutable NFT_V1;
    /// @notice Thrown when the signature is invalid for the NFT payload.
    error InvalidSignature();

    /// @notice Thrown when the issuer is not one of the allowed issuers.
    error IssuerNotAllowed();

    constructor(IIssuersDIDRegistry didRegistry, OpenCampusCertificateNFTv1 nftv1) ContractOwnership(msg.sender) {
        DID_REGISTRY = didRegistry;
        NFT_V1 = nftv1;
    }

    /// @dev signature is ECDSA signature for (to, tokenId, metadata)
    /// @dev signature is a 65 bytes raw signature without compacting
    function mint(address to, uint256 tokenId, CertificateNFTv1MetaData.MetaData calldata metadata, bytes calldata signature) external {
        // recover the signer
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
        address signer = ecrecover(keccak256(abi.encode(to, tokenId, metadata)), v, r, s);
        bytes32 hashedDid = keccak256(abi.encodePacked(metadata.issuerDid));

        if (DID_REGISTRY.isIssuerAllowed(hashedDid, signer)) {
            NFT_V1.mint(to, tokenId, metadata);
        } else {
            revert IssuerNotAllowed();
        }
    }
}
