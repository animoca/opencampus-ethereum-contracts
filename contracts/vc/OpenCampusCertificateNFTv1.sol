// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {AccessControl} from "@animoca/ethereum-contracts/contracts/access/AccessControl.sol";
import {ITokenMetadataResolver} from "@animoca/ethereum-contracts/contracts/token/metadata/interfaces/ITokenMetadataResolver.sol";
import {IRevocationRegistry} from "./interfaces/IRevocationRegistry.sol";
import {IERC721} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721.sol";
import {ERC721Metadata} from "@animoca/ethereum-contracts/contracts/token/ERC721/ERC721Metadata.sol";
import {Transfer} from "@animoca/ethereum-contracts/contracts/token/ERC721/events/ERC721Events.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {ContractOwnershipStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/ContractOwnershipStorage.sol";
import {ERC721Storage} from "@animoca/ethereum-contracts/contracts/token/ERC721/libraries/ERC721Storage.sol";
import {AccessControlStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/AccessControlStorage.sol";
import {CertificateNFTv1MetaData} from "./libraries/CertificateNFTv1MetaData.sol";

contract OpenCampusCertificateNFTv1 is IERC721, ERC721Metadata, AccessControl {
    using ERC721Storage for ERC721Storage.Layout;
    using AccessControlStorage for AccessControlStorage.Layout;
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;
    using CertificateNFTv1MetaData for CertificateNFTv1MetaData.MetaData;

    IRevocationRegistry internal revocationRegistry;

    bytes32 public constant MINTER_ROLE = "minter";
    mapping(uint256 => CertificateNFTv1MetaData.MetaData) public vcData;

    /// @notice Thrown when any transfer functions are called but not allowed.
    error TransferNotAllowed();

    /// @notice Thrown when any operator related methods are called.
    error NoOperatorAllowed();

    error RevocationRegistryNotSet();

    error InvalidBurn();

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        ITokenMetadataResolver metadataResolver
    ) ContractOwnership(msg.sender) ERC721Metadata(tokenName, tokenSymbol, metadataResolver) {
        ERC721Storage.initERC721Mintable();
    }

    function setRevocationRegistry(IRevocationRegistry registry) external {
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());
        revocationRegistry = registry;
    }

    /// @dev Reverts with `NotRoleHolder` if the sender does not have the 'minter' role.
    function mint(address to, uint256 tokenId, CertificateNFTv1MetaData.MetaData calldata metadata) external {
        AccessControlStorage.layout().enforceHasRole(MINTER_ROLE, msg.sender);

        ERC721Storage.layout().mint(to, tokenId);
        vcData[tokenId] = metadata;
    }

    function burn(uint256 tokenId) external {
        if (revocationRegistry == IRevocationRegistry(address(0))) {
            revert RevocationRegistryNotSet();
        }

        bytes32 hashedDid = keccak256(abi.encodePacked(vcData[tokenId].issuerDid));
        if (revocationRegistry.isRevoked(hashedDid, tokenId)) {
            address owner = ERC721Storage.layout().ownerOf(tokenId);
            ERC721Storage.layout().owners[tokenId] = ERC721Storage.BURNT_TOKEN_OWNER_VALUE;

            unchecked {
                // cannot underflow as balance is verified through TOKEN ownership
                --ERC721Storage.layout().balances[owner];
            }
            emit Transfer(owner, address(0), tokenId);
        } else {
            revert InvalidBurn();
        }
    }

    /// @inheritdoc IERC721
    function balanceOf(address owner) external view returns (uint256 balance) {
        return ERC721Storage.layout().balanceOf(owner);
    }

    /// @inheritdoc IERC721
    function ownerOf(uint256 tokenId) external view returns (address tokenOwner) {
        return ERC721Storage.layout().ownerOf(tokenId);
    }

    /// @inheritdoc IERC721
    function getApproved(uint256 tokenId) external view returns (address approved) {
        revert NoOperatorAllowed();
    }

    /// @inheritdoc IERC721
    function approve(address to, uint256 tokenId) external virtual {
        revert TransferNotAllowed();
    }

    /// @inheritdoc IERC721
    function setApprovalForAll(address operator, bool approved) external virtual {
        revert NoOperatorAllowed();
    }

    /// @inheritdoc IERC721
    function transferFrom(address from, address to, uint256 tokenId) external {
        revert TransferNotAllowed();
    }

    /// @inheritdoc IERC721
    function safeTransferFrom(address from, address to, uint256 tokenId) external virtual {
        revert TransferNotAllowed();
    }

    /// @inheritdoc IERC721
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external virtual {
        revert TransferNotAllowed();
    }

    /// @inheritdoc IERC721
    function isApprovedForAll(address owner, address operator) external view returns (bool approvedForAll) {
        revert NoOperatorAllowed();
    }
}
