// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

// other imports
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
// access control imports
import {AccessControl} from "@animoca/ethereum-contracts/contracts/access/AccessControl.sol";
import {AccessControlStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/AccessControlStorage.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {ContractOwnershipStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/ContractOwnershipStorage.sol";
// ERC721 imports
import {IERC721} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721.sol";
import {IERC721Receiver} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721Receiver.sol";
import {ERC721Metadata} from "@animoca/ethereum-contracts/contracts/token/ERC721/ERC721Metadata.sol";
import {Transfer} from "@animoca/ethereum-contracts/contracts/token/ERC721/events/ERC721Events.sol";
import {ERC721Storage} from "@animoca/ethereum-contracts/contracts/token/ERC721/libraries/ERC721Storage.sol";
import {ITokenMetadataResolver} from "@animoca/ethereum-contracts/contracts/token/metadata/interfaces/ITokenMetadataResolver.sol";
// ForwardRegistry imports
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {ForwarderRegistryContext} from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";
// local imports
import {IIssuersDIDRegistry} from "./interfaces/IIssuersDIDRegistry.sol";
import {IRevocationRegistry} from "./interfaces/IRevocationRegistry.sol";
import {CertificateNFTv1MetaData} from "./libraries/CertificateNFTv1MetaData.sol";

contract OpenCampusCertificateNFTv1 is IERC721, ERC721Metadata, AccessControl, ForwarderRegistryContext {
    using Address for address;
    using ERC721Storage for ERC721Storage.Layout;
    using AccessControlStorage for AccessControlStorage.Layout;
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;
    using CertificateNFTv1MetaData for CertificateNFTv1MetaData.MetaData;

    IIssuersDIDRegistry internal immutable DID_REGISTRY;
    IRevocationRegistry internal _revocationRegistry;

    bytes4 internal constant ERC721_RECEIVED = IERC721Receiver.onERC721Received.selector;
    bytes32 public constant MINTER_ROLE = "minter";
    bytes32 public constant OPERATOR_ROLE = "operator";
    mapping(uint256 => CertificateNFTv1MetaData.MetaData) public vcData;

    /// @notice Thrown when burn operation cannot be executed.
    error InvalidBurn();

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        IForwarderRegistry forwarderRegistry,
        ITokenMetadataResolver metadataResolver,
        IRevocationRegistry revocationRegistry,
        IIssuersDIDRegistry didRegistry
    ) ContractOwnership(msg.sender) ForwarderRegistryContext(forwarderRegistry) ERC721Metadata(tokenName, tokenSymbol, metadataResolver) {
        ERC721Storage.initERC721Mintable();
        DID_REGISTRY = didRegistry;
        _revocationRegistry = revocationRegistry;
    }

    /// @param revocationRegistry The address of the Revocation Registry contract.
    function setRevocationRegistry(IRevocationRegistry revocationRegistry) external {
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());
        _revocationRegistry = revocationRegistry;
    }

    /// @dev Reverts with `NotRoleHolder` if the sender does not have the 'minter' role.
    /// @param to The owner of `tokenId`
    /// @param tokenId The id of the VC NFT to be minted
    /// @param metadata Metadata for `tokenId`
    function mint(address to, uint256 tokenId, CertificateNFTv1MetaData.MetaData calldata metadata) external {
        AccessControlStorage.layout().enforceHasRole(MINTER_ROLE, msg.sender);

        ERC721Storage.layout().mint(to, tokenId);
        vcData[tokenId] = metadata;
    }

    /// @dev Reverts with `InvalidBurn` if the tokenId has not been invalidated.
    /// @dev Emit a `Transfer` event to address 0 when the token has been burnt.
    /// @param tokenId The Token Id to be burnt.
    /// Burn tokenId only if tokenId has been legitimately revoked in Revocation Registry.
    function burn(uint256 tokenId) external {
        bytes32 hashedDid = keccak256(abi.encodePacked(vcData[tokenId].issuerDid));
        if (_revocationRegistry.isRevoked(hashedDid, tokenId)) {
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
    function approve(address to, uint256 tokenId) external {
        ERC721Storage.layout().approve(_msgSender(), to, tokenId);
    }

    /// @inheritdoc IERC721
    function setApprovalForAll(address operator, bool approved) external {
        ERC721Storage.layout().setApprovalForAll(_msgSender(), operator, approved);
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
        return ERC721Storage.layout().getApproved(tokenId);
    }

    /// @inheritdoc IERC721
    function isApprovedForAll(address owner, address operator) external view returns (bool approvedForAll) {
        return ERC721Storage.layout().isApprovedForAll(owner, operator);
    }

    /// @notice `sender` is operatable if the sender is a valid issuer for `tokenId` or have been granted `operator` role before
    /// @dev Reverts with `NotRoleHolder` if `sender` is neither allowed token issuer nor an operator for this contract.
    /// @param sender The sender that trigger the contract.
    /// @param tokenId The identifier of the token to transfer.
    function _isSenderOperatable(address sender, uint256 tokenId) internal view {
        bytes32 hashedDid = keccak256(abi.encodePacked(vcData[tokenId].issuerDid));
        // either the sender is allowed to operate on behalf of the issuer
        // or sender has operator role for this NFT
        if (!DID_REGISTRY.issuers(hashedDid, sender)) {
            AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, sender);
        }
    }

    /// @notice after using `_isSenderOperatable` to validate sender's ability to be a valid operator, perform standard ERC721 transferFrom
    /// @inheritdoc IERC721
    function transferFrom(address from, address to, uint256 tokenId) external {
        address sender = _msgSender();
        _isSenderOperatable(sender, tokenId);
        ERC721Storage.layout().transferFrom(sender, from, to, tokenId);
    }

    /// @notice after using `_isSenderOperatable` to validate sender's ability to be a valid operator, perform standard ERC721 safeTransferFrom
    /// @inheritdoc IERC721
    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        address sender = _msgSender();
        _isSenderOperatable(sender, tokenId);
        ERC721Storage.layout().safeTransferFrom(sender, from, to, tokenId);
    }

    /// @notice after using `_isSenderOperatable` to validate sender's ability to be a valid operator, perform standard ERC721 safeTransferFrom
    /// @inheritdoc IERC721
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external {
        address sender = _msgSender();
        _isSenderOperatable(sender, tokenId);
        ERC721Storage.layout().safeTransferFrom(sender, from, to, tokenId, data);
    }

    /// @inheritdoc ForwarderRegistryContextBase
    function _msgSender() internal view override(Context, ForwarderRegistryContextBase) returns (address) {
        return ForwarderRegistryContextBase._msgSender();
    }

    /// @inheritdoc ForwarderRegistryContextBase
    function _msgData() internal view override(Context, ForwarderRegistryContextBase) returns (bytes calldata) {
        return ForwarderRegistryContextBase._msgData();
    }
}
