// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {AccessControl} from "@animoca/ethereum-contracts/contracts/access/AccessControl.sol";
import {ITokenMetadataResolver} from "@animoca/ethereum-contracts/contracts/token/metadata/interfaces/ITokenMetadataResolver.sol";
import {IERC721} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721.sol";
import {IERC721Receiver} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721Receiver.sol";
import {ERC721Metadata} from "@animoca/ethereum-contracts/contracts/token/ERC721/ERC721Metadata.sol";
import {ERC721NonApprovedForTransfer, ERC721NonOwnedToken, ERC721SafeTransferRejected} from "@animoca/ethereum-contracts/contracts/token/ERC721/errors/ERC721Errors.sol";
import {Transfer} from "@animoca/ethereum-contracts/contracts/token/ERC721/events/ERC721Events.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {ContractOwnershipStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/ContractOwnershipStorage.sol";
import {ERC721Storage} from "@animoca/ethereum-contracts/contracts/token/ERC721/libraries/ERC721Storage.sol";
import {AccessControlStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/AccessControlStorage.sol";
import {IIssuersDIDRegistry} from "./interfaces/IIssuersDIDRegistry.sol";
import {IRevocationRegistry} from "./interfaces/IRevocationRegistry.sol";
import {CertificateNFTv1MetaData} from "./libraries/CertificateNFTv1MetaData.sol";
import {TransferAllowed, AllowedTransferRemoved} from "./events/OpenCampusCertificateNFTv1Events.sol";

contract OpenCampusCertificateNFTv1 is IERC721, ERC721Metadata, AccessControl {
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
    mapping(uint256 => address) public allowedTransfers;

    /// @notice Thrown when any transfer functions are called but not allowed.
    error TransferNotAllowed();

    /// @notice Thrown when any operator related methods are called.
    error NoOperatorAllowed();

    /// @notice Thrown when burn operation cannot be executed.
    error InvalidBurn();

    /// @notice Thrown when allowed transfer is called with receipt same as owner.
    error RedundantAllowedTransfer(address recipient);

    /// @notice Thrown when there is no allowed transfer for `tokenId`
    error NonExistingAllowedTransfer(uint256 tokenId);

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        ITokenMetadataResolver metadataResolver,
        IRevocationRegistry revocationRegistry,
        IIssuersDIDRegistry didRegistry
    ) ContractOwnership(msg.sender) ERC721Metadata(tokenName, tokenSymbol, metadataResolver) {
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

    /// @notice Allow a one time transfer of `tokenId` to `recipient`.
    /// @dev emit a `TransferAllowed` event upon successful operation.
    /// @dev Reverts with `NotRoleHolder` if msg.senger is neither allowed token issuer nor an operator for this contract.
    /// @dev Reverts with `ERC721NonExistingToken` if `tokenId` is not a valid token.
    /// @dev Reverts with `RedundantApproval` if `recipient` is the same owner of `tokenId`.
    /// @param recipient The address to which transfer would be allowed.
    /// @param tokenId The tokenId to be allowed for transfer.
    function allowTransfer(address recipient, uint256 tokenId) external {
        bytes32 hashedDid = keccak256(abi.encodePacked(vcData[tokenId].issuerDid));
        // either the sender is allowed to operate on behalf of the issuer
        // or sender has operator role for this NFT
        if (!DID_REGISTRY.issuers(hashedDid, msg.sender)) {
            AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, msg.sender);
        }

        address owner = ERC721Storage.layout().ownerOf(tokenId);
        if (owner == recipient) revert RedundantAllowedTransfer(recipient);

        allowedTransfers[tokenId] = recipient;
        emit TransferAllowed(recipient, tokenId, msg.sender);
    }

    /// @notice Remove the one time transfer that was allowed before for `tokenId`.
    /// @dev emit a `AllowedTransferRemoved` event upon successful operation.
    /// @dev Reverts with `NotRoleHolder` if msg.senger is neither allowed token issuer nor an operator for this contract.
    /// @dev Reverts with `ERC721NonExistingToken` if `tokenId` is not a valid token.
    /// @dev Reverts with `NonExistingApproval` if there is not an allowed transfer for `tokenId`.
    /// @param tokenId The tokenId of which allowed transfer would be removed.
    function removeAllowedTransfer(uint256 tokenId) external {
        bytes32 hashedDid = keccak256(abi.encodePacked(vcData[tokenId].issuerDid));
        // either the sender is allowed to operate on behalf of the issuer
        // or sender has operator role for this NFT
        if (!DID_REGISTRY.issuers(hashedDid, msg.sender)) {
            AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, msg.sender);
        }

        if (allowedTransfers[tokenId] == address(0)) revert NonExistingAllowedTransfer(tokenId);
        emit AllowedTransferRemoved(allowedTransfers[tokenId], tokenId, msg.sender);
        delete allowedTransfers[tokenId];
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

    /// @notice Unsafely transfers the ownership of a token to a recipient by a sender. The transfer has to be previously
    /// approved by a token's issuer or an operator.
    /// @dev Note: This function implements {ERC721-transferFrom(address,address,uint256)}.
    /// @dev remove the existing approval for `tokenId`.
    /// @dev Reverts with {ERC721NonExistingToken} if `tokenId` does not exist.
    /// @dev Reverts with {ERC721NonOwnedToken} if `msg.sender` is not the owner of `tokenId`.
    /// @dev Reverts with {ERC721NonApprovedForTransfer} if `to` has not been approved for transfer for `tokenId`.
    /// @dev Emits a {Transfer} event.
    /// @param from The The current token owner.
    /// @param to The recipient of the token transfer.
    /// @param tokenId The identifier of the token to transfer.
    function transferFrom(address from, address to, uint256 tokenId) public {
        address owner = ERC721Storage.layout().ownerOf(tokenId);
        if (owner != msg.sender) revert ERC721NonOwnedToken(msg.sender, tokenId);
        if (from != owner || allowedTransfers[tokenId] != to) revert ERC721NonApprovedForTransfer(from, owner, tokenId);

        ERC721Storage.layout().owners[tokenId] = uint256(uint160(to));
        // already verified during approval that owner cannot be the same as to
        unchecked {
            // cannot underflow as balance is verified through ownership
            --ERC721Storage.layout().balances[owner];
            //  cannot overflow as supply cannot overflow
            ++ERC721Storage.layout().balances[to];
        }

        delete allowedTransfers[tokenId];
        emit Transfer(owner, to, tokenId);
    }

    /// @notice Unsafely transfers the ownership of a token to a recipient by a sender. The transfer has to be previously
    /// approved by a token's issuer or an operator.
    /// @dev Note: This function implements {ERC721-safeTransferFrom(address,address,uint256)}.
    /// @dev Warning: Since a `to` contract can run arbitrary code, developers should be aware of potential re-entrancy attacks.
    /// @dev remove the existing approval for `tokenId`.
    /// @dev Reverts with {ERC721NonExistingToken} if `tokenId` does not exist.
    /// @dev Reverts with {ERC721NonOwnedToken} if `msg.sender` is not the owner of `tokenId`.
    /// @dev Reverts with {ERC721NonApprovedForTransfer} if `to` has not been approved for transfer for `tokenId`.
    /// @dev Reverts with {ERC721SafeTransferRejected} if `to` is a contract and the call to
    ///  {IERC721Receiver-onERC721Received} fails, reverts or is rejected.
    /// @dev Emits a {Transfer} event.
    /// @param from The The current token owner.
    /// @param to The recipient of the token transfer.
    /// @param tokenId The identifier of the token to transfer.
    function safeTransferFrom(address from, address to, uint256 tokenId) external virtual {
        transferFrom(from, to, tokenId);
        if (to.isContract()) {
            if (IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, "") != ERC721_RECEIVED)
                revert ERC721SafeTransferRejected(to, tokenId);
        }
    }

    /// @notice Unsafely transfers the ownership of a token to a recipient by a sender. The transfer has to be previously
    /// approved by a token's issuer or an operator.
    /// @dev Note: This function implements {ERC721-safeTransferFrom(address,address,uint256)}.
    /// @dev Warning: Since a `to` contract can run arbitrary code, developers should be aware of potential re-entrancy attacks.
    /// @dev remove the existing approval for `tokenId`.
    /// @dev Reverts with {ERC721NonExistingToken} if `tokenId` does not exist.
    /// @dev Reverts with {ERC721NonOwnedToken} if `msg.sender` is not the owner of `tokenId`.
    /// @dev Reverts with {ERC721NonApprovedForTransfer} if `to` has not been approved for transfer for `tokenId`.
    /// @dev Reverts with {ERC721SafeTransferRejected} if `to` is a contract and the call to
    ///  {IERC721Receiver-onERC721Received} fails, reverts or is rejected.
    /// @dev Emits a {Transfer} event.
    /// @param from The The current token owner.
    /// @param to The recipient of the token transfer.
    /// @param tokenId The identifier of the token to transfer.
    /// @param data Optional data to send along to a receiver contract.
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external virtual {
        transferFrom(from, to, tokenId);
        if (to.isContract()) {
            if (IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) != ERC721_RECEIVED)
                revert ERC721SafeTransferRejected(to, tokenId);
        }
    }

    /// @inheritdoc IERC721
    function isApprovedForAll(address owner, address operator) external view returns (bool approvedForAll) {
        revert NoOperatorAllowed();
    }
}
