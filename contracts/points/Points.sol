// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {AccessControlStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/AccessControlStorage.sol";
import {AccessControl} from "@animoca/ethereum-contracts/contracts/access/AccessControl.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {ContractOwnershipStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/ContractOwnershipStorage.sol";
import {ForwarderRegistryContext} from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {IPoints} from "./interface/IPoints.sol";

/// @title Points
/// @notice This contract is designed for managing the point balances of Anichess Game.
contract Points is AccessControl, ForwarderRegistryContext, EIP712, IPoints {
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;
    using AccessControlStorage for AccessControlStorage.Layout;

    bytes32 private constant CONSUME_TYPEHASH =
        keccak256("Consume(address holder,address spender,uint256 amount,bytes32 reasonCode,uint256 deadline,uint256 nonce)");

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SPENDER_ROLE = keccak256("SPENDER_ROLE");
    bytes32 public constant DEPOSITOR_ROLE = keccak256("DEPOSITOR_ROLE");

    mapping(address holder => uint256 balance) public balances;
    mapping(bytes32 hashHolderSpender => uint256 nonce) public nonces;
    mapping(bytes32 => bool) public allowedConsumeReasonCodes;

    /// @notice Emitted when one or more reason code(s) are added to the comsume reason code mapping.
    /// @param reasonCodes The reason codes added to the mapping.
    event ConsumeReasonCodesAdded(bytes32[] indexed reasonCodes);

    /// @notice Emitted when one or more reason code(s) are removed from the comsume reason code mapping.
    /// @param reasonCodes The reason codes removed from the mapping.
    event ConsumeReasonCodesRemoved(bytes32[] indexed reasonCodes);

    /// @notice Emitted when an amount is deposited to a balance.
    /// @param sender The sender of the deposit.
    /// @param reasonCode The reason code of the deposit.
    /// @param holder The holder of the balance deposited to.
    /// @param amount The amount deposited.
    event Deposited(address indexed sender, bytes32 indexed reasonCode, address indexed holder, uint256 amount);

    /// @notice Emitted when an amount is consumed from a balance.
    /// @param holder The holder address of the balance consumed from.
    /// @param reasonCode The reason code of the consumption.
    /// @param operator The sender of the consumption.
    /// @param amount The amount consumed.
    event Consumed(address indexed operator, bytes32 indexed reasonCode, address indexed holder, uint256 amount);

    /// @notice Thrown when the given forwarder registry address is zero address.
    error InvalidForwarderRegistry();

    /// @notice Thrown when the given consume reason codes array is empty.
    error ConsumeReasonCodesArrayEmpty();

    /// @notice Thrown when the given consume reason code already exists in the mapping.
    /// @param reasonCode The reason code that already exists in the mapping.
    error ConsumeReasonCodeAlreadyExists(bytes32 reasonCode);

    /// @notice Thrown when the given reason code does not exist in the mapping.
    /// @param reasonCode The reason code that does not exist in the mapping.
    error ConsumeReasonCodeDoesNotExist(bytes32 reasonCode);

    /// @notice Thrown when depositing zero amount
    error DepositZeroAmount();

    /// @notice Thrown when the holder does not have enough balance
    /// @param holder The given holder address.
    /// @param requiredBalance The required balance.
    error InsufficientBalance(address holder, uint256 requiredBalance);

    /// @notice Thrown when the signature is invalid.
    error InvalidSignature();

    /// @notice Thrown when the signature is expired.
    error ExpiredSignature();

    /// @dev Reverts if the given address is invalid (equal to ZeroAddress).
    constructor(
        IForwarderRegistry forwarderRegistry_
    ) ForwarderRegistryContext(forwarderRegistry_) ContractOwnership(_msgSender()) EIP712("Points", "1.0") {
        if (address(forwarderRegistry_) == address(0)) {
            revert InvalidForwarderRegistry();
        }
    }

    /// @notice retrieve original msg sender of the meta transaction
    function _msgSender() internal view virtual override(Context, ForwarderRegistryContextBase) returns (address) {
        return ForwarderRegistryContextBase._msgSender();
    }

    /// @notice retrieve original msg calldata of the meta transaction
    function _msgData() internal view virtual override(Context, ForwarderRegistryContextBase) returns (bytes calldata) {
        return ForwarderRegistryContextBase._msgData();
    }

    /// @notice Adds one or more reason code(s) to the allowedConsumeReasonCodes mapping.
    /// @dev Reverts if sender does not have Admin role.
    /// @dev Reverts if the given reason codes array is empty.
    /// @dev Reverts if any of the given reason codes already exists in the mapping.
    /// @dev Emits a {ConsumeReasonCodesAdded} event if all the given reason codes are successfully added.
    /// @param reasonCodes Array of reason codes to add.
    function addConsumeReasonCodes(bytes32[] calldata reasonCodes) external {
        AccessControlStorage.layout().enforceHasRole(ADMIN_ROLE, _msgSender());
        if (reasonCodes.length == 0) {
            revert ConsumeReasonCodesArrayEmpty();
        }

        for (uint256 i = 0; i < reasonCodes.length; ++i) {
            if (allowedConsumeReasonCodes[reasonCodes[i]]) {
                revert ConsumeReasonCodeAlreadyExists(reasonCodes[i]);
            }
            allowedConsumeReasonCodes[reasonCodes[i]] = true;
        }
        emit ConsumeReasonCodesAdded(reasonCodes);
    }

    /// @notice Removes one or more reason code(s) from the allowedConsumeReasonCodes mapping.
    /// @dev Reverts if sender does not have Admin role.
    /// @dev Reverts if the given reason codes array is empty.
    /// @dev Reverts if any of the given reason codes do not exist.
    /// @dev Emits a {ConsumeReasonCodesRemoved} event if all the given reason codes are successfully removed.
    /// @param reasonCodes Array of reason codes to remove.
    function removeConsumeReasonCodes(bytes32[] calldata reasonCodes) external {
        AccessControlStorage.layout().enforceHasRole(ADMIN_ROLE, _msgSender());
        if (reasonCodes.length == 0) {
            revert ConsumeReasonCodesArrayEmpty();
        }

        for (uint256 i = 0; i < reasonCodes.length; ++i) {
            if (!allowedConsumeReasonCodes[reasonCodes[i]]) {
                revert ConsumeReasonCodeDoesNotExist(reasonCodes[i]);
            }
            delete allowedConsumeReasonCodes[reasonCodes[i]];
        }
        emit ConsumeReasonCodesRemoved(reasonCodes);
    }

    /// @notice Called by a depositor to increase the balance of a holder.
    /// @dev Reverts if sender does not have Depositor role.
    /// @dev Reverts if deposit amount is zero.
    /// @dev Emits a {Deposited} event if amount has been successfully added to the holder's balance
    /// @param holder The holder of the balance to deposit to.
    /// @param amount The amount to deposit.
    /// @param depositReasonCode The reason code of the deposit.
    function deposit(address holder, uint256 amount, bytes32 depositReasonCode) external {
        address depositor = _msgSender();
        AccessControlStorage.layout().enforceHasRole(DEPOSITOR_ROLE, depositor);

        if (amount == 0) {
            revert DepositZeroAmount();
        }

        balances[holder] += amount;

        emit Deposited(depositor, depositReasonCode, holder, amount);
    }

    /// @notice Called by other public functions to consume a given amount from the balance of the specified holder.
    /// @dev Reverts if balance is insufficient.
    /// @dev Reverts if the consume reason code is not allowed.
    /// @dev Emits a {Consumed} event if the consumption is successful.
    /// @param operator The operator address.
    /// @param holder The balance holder address to deposit to.
    /// @param amount The amount to consume.
    /// @param consumeReasonCode The reason code of the consumption.
    function _consume(address operator, address holder, uint256 amount, bytes32 consumeReasonCode) internal {
        uint256 balance = balances[holder];
        if (balance < amount) {
            revert InsufficientBalance(holder, amount);
        }
        if (!allowedConsumeReasonCodes[consumeReasonCode]) {
            revert ConsumeReasonCodeDoesNotExist(consumeReasonCode);
        }

        balances[holder] = balance - amount;

        emit Consumed(operator, consumeReasonCode, holder, amount);
    }

    /// @notice Called with a signature by an appointed spender to consume a given amount from the balance of a given holder address.
    /// @dev Reverts if deadline of the signature has passed.
    /// @dev Reverts if sender is not appointed spender.
    /// @dev Reverts if signature is not correct (holder, spender, amount, reaconCode, current nonce).
    /// @dev Reverts if signer does not have enough balance
    /// @dev Reverts if the consumeReasonCodes value is false in the mapping.
    /// @dev Emits a {Consumed} event if the consumption is successful.
    /// @param holder The holder to consume from.
    /// @param amount The amount to consume.
    /// @param consumeReasonCode The reason code of the consumption.
    /// @param deadline The deadline of the signature.
    /// @param signature The signature from the holder
    function consume(address holder, uint256 amount, bytes32 consumeReasonCode, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) {
            revert ExpiredSignature();
        }
        address spender = _msgSender();
        bytes32 nonceKey = keccak256(abi.encodePacked(holder, spender));
        uint256 nonce = nonces[nonceKey];

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CONSUME_TYPEHASH, holder, spender, amount, consumeReasonCode, deadline, nonce)));
        bool isValid = SignatureChecker.isValidSignatureNow(holder, digest, signature);
        if (!isValid) {
            revert InvalidSignature();
        }

        _consume(spender, holder, amount, consumeReasonCode);
        nonces[nonceKey] = nonce + 1;
    }

    /// @notice Called by the balance holder to consume a given amount from his balance.
    /// @dev Reverts if sender does not have enough balance
    /// @dev Reverts if the consumeReasonCode value is false in the mapping
    /// @dev Emits a {Consumed} event if the consumption is successful.
    /// @param amount The amount to consume.
    /// @param consumeReasonCode The reason code of the consumption.
    function consume(uint256 amount, bytes32 consumeReasonCode) external {
        address sender = _msgSender();
        _consume(sender, sender, amount, consumeReasonCode);
    }

    /// @notice Called by the spender to consume a given amount from a holder's balance.
    /// @dev Reverts if sender does not have Spender role.
    /// @dev Reverts if holder does not have enough balance
    /// @dev Reverts if the consumeReasonCode value is false in the mapping.
    /// @dev Emits a {Consumed} event if the consumption is successful.
    /// @param holder The holder to consume from.
    /// @param amount The amount to consume.
    /// @param consumeReasonCode The reason code of the consumption.
    function consume(address holder, uint256 amount, bytes32 consumeReasonCode) external {
        address spender = _msgSender();
        AccessControlStorage.layout().enforceHasRole(SPENDER_ROLE, spender);
        _consume(spender, holder, amount, consumeReasonCode);
    }
}
