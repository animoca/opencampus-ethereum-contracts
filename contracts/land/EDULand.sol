// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {AccessControl} from "@animoca/ethereum-contracts/contracts/access/AccessControl.sol";
import {AccessControlStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/AccessControlStorage.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {TokenRecovery} from "@animoca/ethereum-contracts/contracts/security/TokenRecovery.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {ITokenMetadataResolver} from "@animoca/ethereum-contracts/contracts/token/metadata/interfaces/ITokenMetadataResolver.sol";
// solhint-disable-next-line max-line-length
import {ERC721NonExistingToken, ERC721NonOwnedToken, ERC721TransferToAddressZero, ERC721SafeTransferRejected} from "@animoca/ethereum-contracts/contracts/token/ERC721/errors/ERC721Errors.sol";
import {IERC721} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721.sol";
import {IERC721Mintable} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721Mintable.sol";
import {IERC721Receiver} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721Receiver.sol";
import {Transfer} from "@animoca/ethereum-contracts/contracts/token/ERC721/events/ERC721Events.sol";
import {ERC721Storage} from "@animoca/ethereum-contracts/contracts/token/ERC721/libraries/ERC721Storage.sol";
import {ERC721Metadata} from "@animoca/ethereum-contracts/contracts/token/ERC721/ERC721Metadata.sol";
import {IEDULand} from "./interfaces/IEDULand.sol";

/// @title EDULand
/// @notice A contract that implements the ERC721 standard with metadata, minting, burning and transfer operations.
/// @notice Minting, Burning and Transfer operations can only be performed by accounts with the operator role.
/// @notice approve and setApprovalForAll operations are not allowed.
contract EDULand is IEDULand, ERC721Metadata, AccessControl, TokenRecovery {
    using Address for address;
    using ERC721Storage for ERC721Storage.Layout;
    using AccessControlStorage for AccessControlStorage.Layout;

    /// @notice The role identifier for the operator role.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice Burnt token magic value
    /// @notice This magic number is used as the owner's value to indicate that the token has been burnt
    uint256 internal constant BURNT_TOKEN_OWNER_VALUE = 0xdead000000000000000000000000000000000000000000000000000000000000;

    /// @notice error message for approve and setApprovalForAll operations
    error ApprovalNotAllowed();

    /// @notice Constructor
    /// @notice Marks the following ERC165 interface(s) as supported: ERC721, ERC721Mintable, ERC721Burnable, ERC721BatchTransfer
    /// @param tokenName The name of the token.
    /// @param tokenSymbol The symbol of the token.
    /// @param metadataResolver The address of the metadata resolver contract.
    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        ITokenMetadataResolver metadataResolver
    ) ContractOwnership(msg.sender) ERC721Metadata(tokenName, tokenSymbol, metadataResolver) {
        ERC721Storage.init();
        ERC721Storage.initERC721Mintable();
        ERC721Storage.initERC721Burnable();
        ERC721Storage.initERC721BatchTransfer();
    }

    function approve(address, uint256) external pure {
        revert ApprovalNotAllowed();
    }

    function setApprovalForAll(address, bool) external pure {
        revert ApprovalNotAllowed();
    }

    /// @inheritdoc IERC721Mintable
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the operator role.
    function mint(address to, uint256 tokenId) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        ERC721Storage.layout().mint(to, tokenId);
    }

    /// @inheritdoc IERC721Mintable
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the operator role.
    function safeMint(address to, uint256 tokenId, bytes calldata data) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        ERC721Storage.layout().safeMint(_msgSender(), to, tokenId, data);
    }

    /// @inheritdoc IERC721Mintable
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the operator role.
    function batchMint(address to, uint256[] calldata tokenIds) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        ERC721Storage.layout().batchMint(to, tokenIds);
    }

    /// @notice Burns a token.
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the operator role.
    /// @dev Reverts with {ERC721NonExistingToken} if `tokenId` does not exist.
    /// @dev Reverts with {ERC721NonOwnedToken} if `tokenId` is not owned by `from`.
    /// @dev Emits an {IERC721-Transfer} event with `to` set to the zero address.
    /// @param from The current token owner.
    /// @param tokenId The identifier of the token to burn.
    function burnFrom(address from, uint256 tokenId) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());

        ERC721Storage.Layout storage erc721Storage = ERC721Storage.layout();
        address owner = address(uint160(erc721Storage.owners[tokenId]));
        if (owner == address(0)) revert ERC721NonExistingToken(tokenId);
        if (owner != from) revert ERC721NonOwnedToken(from, tokenId);

        erc721Storage.owners[tokenId] = BURNT_TOKEN_OWNER_VALUE;

        unchecked {
            // cannot underflow as balance is verified through TOKEN ownership
            --erc721Storage.balances[from];
        }
        emit Transfer(from, address(0), tokenId);
    }

    /// @notice Burns a batch of tokens.
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the operator role.
    /// @dev Reverts with {ERC721NonExistingToken} if any of the `tokenIds` does not exist.
    /// @dev Reverts with {ERC721NonOwnedToken} if any of the `tokenIds` is not owned by `from`.
    /// @dev Emits an {IERC721-Transfer} event with `to` set to the zero address for each of `tokenIds`.
    /// @param from The current token owner.
    /// @param tokenIds The identifiers of the tokens to burn.
    function batchBurnFrom(address from, uint256[] calldata tokenIds) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());

        ERC721Storage.Layout storage erc721Storage = ERC721Storage.layout();
        uint256 length = tokenIds.length;
        for (uint256 i; i < length; ++i) {
            uint256 tokenId = tokenIds[i];
            address owner = address(uint160(erc721Storage.owners[tokenId]));
            if (owner == address(0)) revert ERC721NonExistingToken(tokenId);
            if (owner != from) revert ERC721NonOwnedToken(from, tokenId);

            erc721Storage.owners[tokenId] = BURNT_TOKEN_OWNER_VALUE;
            emit Transfer(from, address(0), tokenId);
        }

        if (length != 0) {
            unchecked {
                // cannot underflow as balance is verified through TOKEN ownership
                erc721Storage.balances[from] -= length;
            }
        }
    }

    /// @inheritdoc IERC721
    /// @dev This implementation enforces role-based access control and does not rely on sender approval.
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the {OPERATOR_ROLE}.
    function transferFrom(address from, address to, uint256 tokenId) external {
        transferFrom_(from, to, tokenId);
    }

    /// @inheritdoc IERC721
    /// @dev This implementation enforces role-based access control and does not rely on sender approval.
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the {OPERATOR_ROLE}.
    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom_(from, to, tokenId);
        if (to.isContract()) {
            if (IERC721Receiver(to).onERC721Received(_msgSender(), from, tokenId, "") != IERC721Receiver.onERC721Received.selector) {
                revert ERC721SafeTransferRejected(to, tokenId);
            }
        }
    }

    /// @inheritdoc IERC721
    /// @dev This implementation enforces role-based access control and does not rely on sender approval.
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the {OPERATOR_ROLE}.
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external {
        transferFrom_(from, to, tokenId);
        if (to.isContract()) {
            if (IERC721Receiver(to).onERC721Received(_msgSender(), from, tokenId, data) != IERC721Receiver.onERC721Received.selector) {
                revert ERC721SafeTransferRejected(to, tokenId);
            }
        }
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
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());

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
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());

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
}
