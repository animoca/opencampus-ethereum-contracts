// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {InconsistentArrayLengths} from "@animoca/ethereum-contracts/contracts/CommonErrors.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {TokenRecovery} from "@animoca/ethereum-contracts/contracts/security/TokenRecovery.sol";
import {ERC1155TokenReceiver} from "@animoca/ethereum-contracts/contracts/token/ERC1155/ERC1155TokenReceiver.sol";
import {IERC1155TokenReceiver} from "@animoca/ethereum-contracts/contracts/token/ERC1155/interfaces/IERC1155TokenReceiver.sol";
import {IERC1155} from "@animoca/ethereum-contracts/contracts/token/ERC1155/interfaces/IERC1155.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {ForwarderRegistryContext} from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";

/// @title TokenEscrow contract
/// @notice Contract that allows users to escrow tokens for use in the Anichess Game.
contract GenesisTokenEscrow is TokenRecovery, ERC1155TokenReceiver, ForwarderRegistryContext {
    struct Escrow {
        uint128 genesis1Quantity;
        uint128 genesis2Quantity;
    }

    /// @notice Emitted when tokens are deposited
    event Deposited(address indexed account, address[] publisherTokenAddresses, uint256[] publisherTokenIds, Escrow[] escrows);

    /// @notice Emitted when tokens are withdrawn
    event Withdrawn(address indexed account, address[] publisherTokenAddresses, uint256[] publisherTokenIds);

    /// Custom errors
    error InvalidInventory(address inventory);
    error InvalidInputParams();
    error NotEscrowed(address account, address publisherTokenAddress, uint256 publisherTokenId);

    IERC1155 public immutable GENESIS_TOKEN;

    /// @notice escrowed[account][genesisTokenId] = [{publisherTokenAddress, publisherTokenId, quantity}]
    mapping(address => mapping(address => mapping(uint256 => Escrow))) public escrowed;

    /// @notice Creates a new escrow contract
    /// @dev Throws if the _inventory address is a zero address.
    /// @dev ContractOwnership is required to initiate TokenRecovery
    /// @param genesisToken_ The inventory contract address
    constructor(
        address genesisToken_,
        IForwarderRegistry forwarderRegistry
    ) ContractOwnership(_msgSender()) ForwarderRegistryContext(forwarderRegistry) {
        if (genesisToken_ == address(0)) {
            revert InvalidInventory(genesisToken_);
        }
        GENESIS_TOKEN = IERC1155(genesisToken_);
    }

    /// @notice Handles the receipt of a single type of token.
    /// @dev Reverts if the sender is not the inventory.
    /// @dev Updates the escrowed mapping.
    /// @dev Emits a {Deposited} event.
    /// @param from The address which previously owned the token
    /// @param id The ID of the token being transferred
    /// @param quantity The quantity of the token being transferred
    /// @param data A bytes array containing which publisher token address and id should be escrowed into.
    /// @return selector The function selector
    function onERC1155Received(address, address from, uint256 id, uint256 quantity, bytes calldata data) external returns (bytes4) {
        address inventoryAddress = _msgSender();
        if (inventoryAddress != address(GENESIS_TOKEN)) {
            revert InvalidInventory(inventoryAddress);
        }

        (address publisherTokenAddress, uint256 publisherTokenId) = abi.decode(data, (address, uint256));
        Escrow storage escrow = escrowed[from][publisherTokenAddress][publisherTokenId];
        if (id == 1) {
            escrow.genesis1Quantity += uint128(quantity);
        } else if (id == 2) {
            escrow.genesis2Quantity += uint128(quantity);
        } else {
            revert InvalidInputParams();
        }

        address[] memory publisherTokenAddresses = new address[](1);
        uint256[] memory publisherTokenIds = new uint256[](1);
        Escrow[] memory escrows = new Escrow[](1);
        publisherTokenAddresses[0] = publisherTokenAddress;
        publisherTokenIds[0] = publisherTokenId;
        escrows[0] = escrow;
        emit Deposited(from, publisherTokenAddresses, publisherTokenIds, escrows);

        return IERC1155TokenReceiver.onERC1155Received.selector;
    }

    /// @notice Handles the receipt of multiple types of tokens.
    /// @dev Reverts if the sender is not in the inventory.
    /// @dev Updates the escrowed mapping.
    /// @dev Emits {Deposited} events.
    /// @param from The address which previously owned the token
    /// @param ids An array containing ids of each token being transferred (corresponds to orbTypes)
    /// @param quantities An array containing amounts of each token being transferred (corresponds to quantities)
    /// @param data A bytes array containing which 1155 tokens should escrowed into which publisher token addresses and ids.
    /// @return selector The function selector
    function onERC1155BatchReceived(
        address,
        address from,
        uint256[] calldata ids,
        uint256[] calldata quantities,
        bytes calldata data
    ) external returns (bytes4) {
        (
            address[] memory publisherTokenAddresses,
            uint256[] memory publisherTokenIds,
            uint128[] memory genesis1Quantities,
            uint128[] memory genesis2Quantities
        ) = abi.decode(data, (address[], uint256[], uint128[], uint128[]));

        if (publisherTokenAddresses.length != publisherTokenIds.length) {
            revert InconsistentArrayLengths();
        }

        if (publisherTokenAddresses.length != genesis1Quantities.length) {
            revert InconsistentArrayLengths();
        }

        if (publisherTokenAddresses.length != genesis2Quantities.length) {
            revert InconsistentArrayLengths();
        }

        // For verifying the data with ids and values
        uint256 genesis1Total = 0;
        uint256 genesis2Total = 0;

        Escrow[] memory escrows = new Escrow[](publisherTokenAddresses.length);
        address fromAddress = from;
        for (uint256 i = 0; i < publisherTokenAddresses.length; i++) {
            Escrow storage escrow = escrowed[fromAddress][publisherTokenAddresses[i]][publisherTokenIds[i]];
            escrow.genesis1Quantity += genesis1Quantities[i];
            escrow.genesis2Quantity += genesis2Quantities[i];
            escrows[i] = escrow;

            genesis1Total += genesis1Quantities[i];
            genesis2Total += genesis2Quantities[i];
        }

        // verifying the data with ids and values
        uint256[] memory tokenIds = ids;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 id = tokenIds[i];
            if (id == 1) {
                if (genesis1Total < quantities[i]) {
                    revert InvalidInputParams();
                }

                genesis1Total -= quantities[i];
            } else if (id == 2) {
                if (genesis2Total < quantities[i]) {
                    revert InvalidInputParams();
                }

                genesis2Total -= quantities[i];
            } else {
                revert InvalidInputParams();
            }
        }

        if (genesis1Total != 0) {
            revert InvalidInputParams();
        }

        if (genesis2Total != 0) {
            revert InvalidInputParams();
        }

        emit Deposited(fromAddress, publisherTokenAddresses, publisherTokenIds, escrows);

        return IERC1155TokenReceiver.onERC1155BatchReceived.selector;
    }

    /// @notice Handles token withdrawal
    /// @dev Reverts if the sender did not escrow the token for the specified publisher token.
    /// @dev Emits a {Withdrawn} event.
    /// @dev Transfers the token from this contract to the sender's address
    function withdraw(address[] calldata publisherTokenAddresses, uint256[] calldata publisherTokenIds) external {
        if (publisherTokenAddresses.length != publisherTokenIds.length) {
            revert InconsistentArrayLengths();
        }

        address account = _msgSender();
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;

        uint256[] memory values = new uint256[](2);
        for (uint256 i = 0; i < publisherTokenAddresses.length; i++) {
            address publisherTokenAddress = publisherTokenAddresses[i];
            uint256 publisherTokenId = publisherTokenIds[i];

            Escrow memory prevEscrow = escrowed[account][publisherTokenAddress][publisherTokenId];
            if (prevEscrow.genesis1Quantity != 0 || prevEscrow.genesis2Quantity != 0) {
                escrowed[account][publisherTokenAddress][publisherTokenId] = Escrow(0, 0);

                values[0] += prevEscrow.genesis1Quantity;
                values[1] += prevEscrow.genesis2Quantity;
            } else {
                revert NotEscrowed(account, publisherTokenAddress, publisherTokenId);
            }
        }

        emit Withdrawn(account, publisherTokenAddresses, publisherTokenIds);

        GENESIS_TOKEN.safeBatchTransferFrom(address(this), _msgSender(), ids, values, "");
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