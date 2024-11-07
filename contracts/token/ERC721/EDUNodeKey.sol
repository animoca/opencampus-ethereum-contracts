// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

// solhint-disable-next-line max-line-length
import {ERC721TransferToAddressZero, ERC721NonExistingToken, ERC721NonOwnedToken, ERC721SafeTransferRejected} from "@animoca/ethereum-contracts/contracts/token/ERC721/errors/ERC721Errors.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IERC721} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721.sol";
import {IERC721Receiver} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721Receiver.sol";
import {IERC721BatchTransfer} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721BatchTransfer.sol";
import {Transfer} from "@animoca/ethereum-contracts/contracts/token/ERC721/events/ERC721Events.sol";
import {ERC721Storage} from "@animoca/ethereum-contracts/contracts/token/ERC721/libraries/ERC721Storage.sol";
import {ERC721Metadata} from "@animoca/ethereum-contracts/contracts/token/ERC721/ERC721Metadata.sol";
import {ERC721Mintable} from "@animoca/ethereum-contracts/contracts/token/ERC721/ERC721Mintable.sol";
import {ERC721Deliverable} from "@animoca/ethereum-contracts/contracts/token/ERC721/ERC721Deliverable.sol";
import {TokenRecovery} from "@animoca/ethereum-contracts/contracts/security/TokenRecovery.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {ITokenMetadataResolver} from "@animoca/ethereum-contracts/contracts/token/metadata/interfaces/ITokenMetadataResolver.sol";
import {ForwarderRegistryContext} from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {AccessControlStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/AccessControlStorage.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {ContractOwnershipStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/ContractOwnershipStorage.sol";

/// @title EDUNodeKey
/// @notice A contract that implements the ERC721 standard with metadata, minting, deliverable, batch transfer support.
/// @notice Only accounts with the operator role can transfer tokens. Sets or unsets an approval have no effect.
contract EDUNodeKey is IERC721, ERC721Metadata, ERC721Mintable, ERC721Deliverable, IERC721BatchTransfer, TokenRecovery, ForwarderRegistryContext {
    using Address for address;
    using ERC721Storage for ERC721Storage.Layout;
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;
    using AccessControlStorage for AccessControlStorage.Layout;

    /// @notice The role identifier for the operator role.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice Constructor
    /// @param tokenName The name of the token.
    /// @param tokenSymbol The symbol of the token.
    /// @param metadataResolver The address of the metadata resolver contract.
    /// @param forwarderRegistry The address of the forwarder registry contract.
    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        ITokenMetadataResolver metadataResolver,
        IForwarderRegistry forwarderRegistry
    ) ContractOwnership(msg.sender) ERC721Metadata(tokenName, tokenSymbol, metadataResolver) ForwarderRegistryContext(forwarderRegistry) {
        ERC721Storage.init();
        ERC721Storage.initERC721BatchTransfer();
    }

    /// @inheritdoc IERC721
    function approve(address to, uint256 tokenId) external virtual {
        ERC721Storage.layout().approve(_msgSender(), to, tokenId);
    }

    /// @inheritdoc IERC721
    function setApprovalForAll(address operator, bool approved) external virtual {
        ERC721Storage.layout().setApprovalForAll(_msgSender(), operator, approved);
    }

    /// @notice Unsafely transfers a batch of tokens to a recipient by a sender.
    /// @dev Resets the token approval for each of `tokenIds`.
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the {OPERATOR_ROLE}.
    /// @dev Reverts with {ERC721TransferToAddressZero} if `to` is the zero address.
    /// @dev Reverts with {ERC721NonExistingToken} if one of `tokenIds` does not exist.
    /// @dev Reverts with {ERC721NonOwnedToken} if one of `tokenIds` is not owned by `from`.
    /// @dev Emits a {Transfer} event for each of `tokenIds`.
    /// @param from Current tokens owner.
    /// @param to Address of the new token owner.
    /// @param tokenIds Identifiers of the tokens to transfer.
    function batchTransferFrom(address from, address to, uint256[] calldata tokenIds) external {
        address msgSender = _msgSender();
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, msgSender);

        if (to == address(0)) revert ERC721TransferToAddressZero();

        ERC721Storage.Layout storage erc721Storage = ERC721Storage.layout();
        uint256 length = tokenIds.length;
        for (uint256 i; i < length; ++i) {
            uint256 tokenId = tokenIds[i];
            address owner = address(uint160(erc721Storage.owners[tokenId]));
            if (owner == address(0)) revert ERC721NonExistingToken(tokenId);
            if (owner != from) revert ERC721NonOwnedToken(from, tokenId);
            erc721Storage.owners[tokenId] = uint256(uint160(to));
            emit Transfer(from, to, tokenId);
        }

        if (from != to && length != 0) {
            unchecked {
                // cannot underflow as balance is verified through ownership
                erc721Storage.balances[from] -= length;
                //  cannot overflow as supply cannot overflow
                erc721Storage.balances[to] += length;
            }
        }
    }

    /// @notice Unsafely transfers the ownership of a token to a recipient by a sender.
    /// @dev Resets the token approval for `tokenId`.
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the {OPERATOR_ROLE}.
    /// @dev Reverts with {ERC721TransferToAddressZero} if `to` is the zero address.
    /// @dev Reverts with {ERC721NonExistingToken} if `tokenId` does not exist.
    /// @dev Reverts with {ERC721NonOwnedToken} if `from` is not the owner of `tokenId`.
    /// @dev Emits a {Transfer} event.
    /// @param from The current token owner.
    /// @param to The recipient of the token transfer.
    /// @param tokenId The identifier of the token to transfer.
    function transferFrom_(address from, address to, uint256 tokenId) internal {
        address msgSender = _msgSender();
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, msgSender);

        if (to == address(0)) revert ERC721TransferToAddressZero();

        ERC721Storage.Layout storage erc721Storage = ERC721Storage.layout();
        address owner = address(uint160(erc721Storage.owners[tokenId]));
        if (owner == address(0)) revert ERC721NonExistingToken(tokenId);
        if (owner != from) revert ERC721NonOwnedToken(from, tokenId);

        erc721Storage.owners[tokenId] = uint256(uint160(to));
        if (from != to) {
            unchecked {
                // cannot underflow as balance is verified through ownership
                --erc721Storage.balances[from];
                //  cannot overflow as supply cannot overflow
                ++erc721Storage.balances[to];
            }
        }
        emit Transfer(from, to, tokenId);
    }

    /// @inheritdoc IERC721
    function transferFrom(address from, address to, uint256 tokenId) external {
        transferFrom_(from, to, tokenId);
    }

    /// @inheritdoc IERC721
    function safeTransferFrom(address from, address to, uint256 tokenId) external virtual {
        transferFrom_(from, to, tokenId);
        if (to.isContract()) {
            if (IERC721Receiver(to).onERC721Received(_msgSender(), from, tokenId, "") != IERC721Receiver.onERC721Received.selector) {
                revert ERC721SafeTransferRejected(to, tokenId);
            }
        }
    }

    /// @inheritdoc IERC721
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external virtual {
        transferFrom_(from, to, tokenId);
        if (to.isContract()) {
            if (IERC721Receiver(to).onERC721Received(_msgSender(), from, tokenId, data) != IERC721Receiver.onERC721Received.selector) {
                revert ERC721SafeTransferRejected(to, tokenId);
            }
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
        return ERC721Storage.layout().getApproved(tokenId);
    }

    /// @inheritdoc IERC721
    function isApprovedForAll(address owner, address operator) external view returns (bool approvedForAll) {
        return ERC721Storage.layout().isApprovedForAll(owner, operator);
    }

    /// @inheritdoc ForwarderRegistryContextBase
    function _msgSender() internal view virtual override(Context, ForwarderRegistryContextBase) returns (address) {
        return ForwarderRegistryContextBase._msgSender();
    }

    /// @inheritdoc ForwarderRegistryContextBase
    function _msgData() internal view virtual override(Context, ForwarderRegistryContextBase) returns (bytes calldata) {
        return ForwarderRegistryContextBase._msgData();
    }
}
