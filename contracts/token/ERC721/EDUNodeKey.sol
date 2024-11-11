// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {ERC721NonExistingToken, ERC721NonOwnedToken} from "@animoca/ethereum-contracts/contracts/token/ERC721/errors/ERC721Errors.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {AccessControl} from "@animoca/ethereum-contracts/contracts/access/AccessControl.sol";
import {IERC721} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721.sol";
import {Transfer} from "@animoca/ethereum-contracts/contracts/token/ERC721/events/ERC721Events.sol";
import {ERC721Storage} from "@animoca/ethereum-contracts/contracts/token/ERC721/libraries/ERC721Storage.sol";
import {ERC721Metadata} from "@animoca/ethereum-contracts/contracts/token/ERC721/ERC721Metadata.sol";
import {TokenRecovery} from "@animoca/ethereum-contracts/contracts/security/TokenRecovery.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {ITokenMetadataResolver} from "@animoca/ethereum-contracts/contracts/token/metadata/interfaces/ITokenMetadataResolver.sol";
import {ForwarderRegistryContext} from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {AccessControlStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/AccessControlStorage.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {IEDUNodeKey} from "./interfaces/IEDUNodeKey.sol";

/// @title EDUNodeKey
/// @notice A contract that implements the ERC721 standard with metadata, minting, burning.
/// @notice Minting and Burning can only be performed by accounts with the operator role.
/// @notice Transferability is disabled.
contract EDUNodeKey is IERC721, IEDUNodeKey, ERC721Metadata, AccessControl, TokenRecovery, ForwarderRegistryContext {
    /// @notice Thrown for any transfer attempts.
    error NotTransferable();

    using Address for address;
    using ERC721Storage for ERC721Storage.Layout;
    using AccessControlStorage for AccessControlStorage.Layout;

    /// @notice The role identifier for the operator role.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice Burnt token magic value
    /// @notice This magic number is used as the owner's value to indicate that the token has been burnt
    uint256 internal constant EDU_NODE_KEY_BURNT_TOKEN_OWNER_VALUE = 0xdead000000000000000000000000000000000000000000000000000000000000;

    /// @notice Constructor
    /// @notice Marks the following ERC165 interface(s) as supported: ERC721, ERC721Mintable, ERC721Deliverable, ERC721Burnable.
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
        ERC721Storage.initERC721Mintable();
        ERC721Storage.initERC721Deliverable();
        ERC721Storage.initERC721Burnable();
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
    /// @dev Reverts in any case, as this contract does not support transfering tokens.
    function transferFrom(address /*from*/, address /*to*/, uint256 /*tokenId*/) external virtual {
        revert NotTransferable();
    }

    /// @inheritdoc IERC721
    /// @dev Reverts in any case, as this contract does not support transfering tokens.
    function safeTransferFrom(address /*from*/, address /*to*/, uint256 /*tokenId*/) external virtual {
        revert NotTransferable();
    }

    /// @inheritdoc IERC721
    /// @dev Reverts in any case, as this contract does not support transfering tokens.
    function safeTransferFrom(address /*from*/, address /*to*/, uint256 /*tokenId*/, bytes calldata /*data*/) external virtual {
        revert NotTransferable();
    }

    /// @inheritdoc IEDUNodeKey
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the operator role.
    function mint(address to, uint256 tokenId) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        ERC721Storage.layout().mint(to, tokenId);
    }

    /// @inheritdoc IEDUNodeKey
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the operator role.
    function safeMint(address to, uint256 tokenId, bytes calldata data) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        ERC721Storage.layout().safeMint(_msgSender(), to, tokenId, data);
    }

    /// @inheritdoc IEDUNodeKey
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the operator role.
    function batchMint(address to, uint256[] calldata tokenIds) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        ERC721Storage.layout().batchMint(to, tokenIds);
    }

    /// @inheritdoc IEDUNodeKey
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the operator role.
    function deliver(address[] calldata recipients, uint256[] calldata tokenIds) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        ERC721Storage.layout().deliver(recipients, tokenIds);
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

        erc721Storage.owners[tokenId] = EDU_NODE_KEY_BURNT_TOKEN_OWNER_VALUE;

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

            erc721Storage.owners[tokenId] = EDU_NODE_KEY_BURNT_TOKEN_OWNER_VALUE;
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
