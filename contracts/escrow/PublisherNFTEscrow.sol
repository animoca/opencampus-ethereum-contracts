// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {InconsistentArrayLengths} from "@animoca/ethereum-contracts/contracts/CommonErrors.sol";
import {ContractOwnershipStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/ContractOwnershipStorage.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {TokenRecovery} from "@animoca/ethereum-contracts/contracts/security/TokenRecovery.sol";
import {ERC721Receiver} from "@animoca/ethereum-contracts/contracts/token/ERC721/ERC721Receiver.sol";
import {IERC721Receiver} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721Receiver.sol";
import {IERC721} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {ForwarderRegistryContext} from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";

contract PublisherNFTEscrow is TokenRecovery, ERC721Receiver, ForwarderRegistryContext {
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;

    /// @notice Emitted whenever a token is deposited
    event Deposited(address indexed account, address[] inventories, uint256[] ids);

    /// @notice Emitted whenever a token is withdrawn
    event Withdrawn(address indexed account, address[] inventories, uint256[] ids);

    /// @notice Emitted whenever a supported token is added
    event SupportedInventoryAdded(address indexed inventory);

    /// @notice Emitted whenever a supported token is removed
    event SupportedInventoryRemoved(address indexed inventory);

    mapping(address => mapping(uint256 => address)) public escrowed;

    mapping(address => address) public supportedInventories;

    error NotRecoverable(address inventory, uint256 id);
    error UnsupportedInventory(address inventory);
    error NotEscrowed(address inventory, uint256 id);

    constructor(
        address[] memory supportedInventories_,
        IForwarderRegistry forwarderRegistry
    ) ContractOwnership(msg.sender) ForwarderRegistryContext(forwarderRegistry) {
        uint256 length = supportedInventories_.length;
        for (uint256 i; i < length; ++i) {
            address inventory = supportedInventories_[i];
            if (inventory == address(0)) {
                revert UnsupportedInventory(inventory);
            }

            emit SupportedInventoryAdded(inventory);
            supportedInventories[inventory] = inventory;
        }
    }

    function addSupportedInventory(address inventory) public {
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());

        if (inventory == address(0)) {
            revert UnsupportedInventory(inventory);
        }

        emit SupportedInventoryAdded(inventory);
        supportedInventories[inventory] = inventory;
    }

    function removeSupportedInventory(address inventory) public {
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());

        if (supportedInventories[inventory] == address(0)) {
            revert UnsupportedInventory(inventory);
        }

        emit SupportedInventoryRemoved(inventory);
        delete supportedInventories[inventory];
    }

    function deposit(address[] calldata inventories, uint256[] calldata ids) public {
        uint256 length = inventories.length;
        if (length != ids.length) {
            revert InconsistentArrayLengths();
        }

        address account = _msgSender();
        for (uint256 i; i < length; ++i) {
            address inventory = inventories[i];
            uint256 id = ids[i];
            if (supportedInventories[inventory] == address(0)) {
                revert UnsupportedInventory(inventory);
            }

            escrowed[inventory][id] = account;
            IERC721(inventory).transferFrom(account, address(this), id);
        }

        emit Deposited(account, inventories, ids);
    }

    function withdraw(address[] calldata inventories, uint256[] calldata ids) public {
        uint256 length = inventories.length;
        if (length != ids.length) {
            revert InconsistentArrayLengths();
        }

        address account = _msgSender();
        for (uint256 i; i < length; ++i) {
            address inventoryAddress = inventories[i];
            uint256 id = ids[i];
            address owner = escrowed[inventoryAddress][id];
            if (owner != account) {
                revert NotEscrowed(inventoryAddress, id);
            }

            escrowed[inventoryAddress][id] = address(0);
            IERC721 inventory = IERC721(inventoryAddress);
            inventory.safeTransferFrom(address(this), owner, id);
        }

        emit Withdrawn(account, inventories, ids);
    }

    /// @notice Handles the receipt of an ERC721 token.
    /// @dev Note: This function is called by an ERC721 contract after a safe transfer.
    /// @dev Note: The ERC721 contract address is always the message sender.
    /// @param from The previous token owner.
    /// @param id The token identifier.
    /// @return selector The function selector
    function onERC721Received(address, address from, uint256 id, bytes calldata) external returns (bytes4) {
        address inventory = msg.sender;
        if (supportedInventories[inventory] == address(0)) {
            revert UnsupportedInventory(inventory);
        }

        escrowed[inventory][id] = from;

        address[] memory inventories = new address[](1);
        inventories[0] = inventory;
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        emit Deposited(from, inventories, ids);

        return IERC721Receiver.onERC721Received.selector;
    }

    function recoverERC721s(address[] calldata accounts, IERC721[] calldata contracts, uint256[] calldata tokenIds) public virtual override {
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());
        uint256 length = contracts.length;
        if (accounts.length != length) {
            revert InconsistentArrayLengths();
        }

        if (tokenIds.length != length) {
            revert InconsistentArrayLengths();
        }

        for (uint256 i; i < length; ++i) {
            address account = accounts[i];
            IERC721 inventory = contracts[i];
            address inventoryAddress = address(inventory);
            uint256 tokenId = tokenIds[i];
            if (escrowed[inventoryAddress][tokenId] != address(0)) {
                revert NotRecoverable(inventoryAddress, tokenId);
            }

            inventory.safeTransferFrom(address(this), account, tokenId);
        }
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
