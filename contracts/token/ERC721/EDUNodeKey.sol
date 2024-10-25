// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IERC721} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721.sol";
import {IERC721Receiver} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721Receiver.sol";
import {IERC721BatchTransfer} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721BatchTransfer.sol";
import {ERC721TransferToAddressZero, ERC721NonExistingToken, ERC721NonOwnedToken, ERC721SafeTransferRejected} from "@animoca/ethereum-contracts/contracts/token/ERC721/errors/ERC721Errors.sol";
import {Transfer} from "@animoca/ethereum-contracts/contracts/token/ERC721/events/ERC721Events.sol";
import {ERC721Storage} from "@animoca/ethereum-contracts/contracts/token/ERC721/libraries/ERC721Storage.sol";
import {ERC721Metadata} from "@animoca/ethereum-contracts/contracts/token/ERC721/ERC721Metadata.sol";
import {ERC721Mintable} from "@animoca/ethereum-contracts/contracts/token/ERC721/ERC721Mintable.sol";
import {ERC721Deliverable} from "@animoca/ethereum-contracts/contracts/token/ERC721/ERC721Deliverable.sol";
import {TokenRecovery} from "@animoca/ethereum-contracts/contracts/security/TokenRecovery.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {ITokenMetadataResolver} from "@animoca/ethereum-contracts/contracts/token/metadata/interfaces/ITokenMetadataResolver.sol";
import {ForwarderRegistryContext}  from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {AccessControlStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/AccessControlStorage.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {ContractOwnershipStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/ContractOwnershipStorage.sol";

contract EDUNodeKey is
    IERC721,
    ERC721Metadata,
    ERC721Mintable,
    ERC721Deliverable,
    TokenRecovery,
    ForwarderRegistryContext
{
    using Address for address;
    using ERC721Storage for ERC721Storage.Layout;
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;
    using AccessControlStorage for AccessControlStorage.Layout;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        ITokenMetadataResolver metadataResolver,
        IForwarderRegistry forwarderRegistry
    )
        ContractOwnership(msg.sender)
        ERC721Metadata(tokenName, tokenSymbol, metadataResolver)
        ForwarderRegistryContext(forwarderRegistry)
    {}

    /// @inheritdoc IERC721
    function approve(address to, uint256 tokenId) external virtual {
        ERC721Storage.layout().approve(_msgSender(), to, tokenId);
    }

    /// @inheritdoc IERC721
    function setApprovalForAll(address operator, bool approved) external virtual {
        ERC721Storage.layout().setApprovalForAll(_msgSender(), operator, approved);
    }

    /// @notice Unsafely transfers a batch of tokens to a recipient.
    /// @dev Resets the token approval for each of `tokenIds`.
    /// @dev Reverts if `to` is the zero address.
    /// @dev Reverts if one of `tokenIds` is not owned by `from`.
    /// @dev Reverts if the sender is not `from` and has not been approved by `from` for each of `tokenIds`.
    /// @dev Emits an {IERC721-Transfer} event for each of `tokenIds`.
    /// @param from Current tokens owner.
    /// @param to Address of the new token owner.
    /// @param tokenIds Identifiers of the tokens to transfer.
    function batchTransferFrom(address from, address to, uint256[] calldata tokenIds) external {
        address msgSender = _msgSender();
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, msgSender);
        ERC721Storage.layout().batchTransferFrom(msgSender, from, to, tokenIds);
    }

    function transferFrom_(address from, address to, uint256 tokenId) internal {
        address msgSender = _msgSender();
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, msgSender);

        if (to == address(0)) revert ERC721TransferToAddressZero();

        uint256 owner = ERC721Storage.layout().owners[tokenId];
        if (uint160(owner) == 0) revert ERC721NonExistingToken(tokenId);
        if (address(uint160(owner)) != from) revert ERC721NonOwnedToken(from, tokenId);

        ERC721Storage.layout().owners[tokenId] = uint256(uint160(to));

        --ERC721Storage.layout().balances[from];
        ++ERC721Storage.layout().balances[to];

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