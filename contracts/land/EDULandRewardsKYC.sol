// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {AccessControlStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/AccessControlStorage.sol";
import {AccessControl} from "@animoca/ethereum-contracts/contracts/access/AccessControl.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {ContractOwnershipStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/ContractOwnershipStorage.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {ForwarderRegistryContext} from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";
import {IEDULandRewards} from "./interfaces/IEDULandRewards.sol";

/// @title EDULandRewardsKYC
/// @notice A contract for managing KYC wallets for EDULandRewards.
/// @notice This contract allows adding KYC wallet with a valid EIP712 signature by anyone.
/// @notice It also allows adding and removing KYC wallets by the operator.
contract EDULandRewardsKYC is AccessControl, ForwarderRegistryContext, EIP712 {
    using ECDSA for bytes32;
    using AccessControlStorage for AccessControlStorage.Layout;
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;

    IEDULandRewards public immutable EDU_LAND_REWARDS;

    /// @notice The address of the message signer.
    address public messageSigner;

    /// @notice The role identifier for the operator role.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice The signature typehash for the addKycWalletWithSignature function.
    bytes32 private constant ADD_KYC_WALLET_TYPEHASH = keccak256("addKycWalletWithSignature(address wallet,uint256 expireAt)");

    /// @notice Emitted when the message signer is set.
    /// @param messageSigner The new message signer.
    event MessageSignerSet(address messageSigner);

    /// @notice Emitted when KYC wallets are added.
    /// @param wallets A list of wallet addresses added.
    event KycWalletsAdded(address[] wallets);

    /// @notice Emitted when KYC wallets are removed.
    /// @param wallets A list of wallet addresses removed.
    event KycWalletsRemoved(address[] wallets);

    /// @notice Thrown when the signature is expired.
    /// @param wallet The wallet to add to KYC list.
    /// @param expireAt The expiration timestamp of the signature.
    /// @param signature The signature to verify.
    error ExpiredSignature(address wallet, uint256 expireAt, bytes signature);

    /// @notice Thrown when the signature is invalid.
    /// @param wallet The wallet to add to KYC list.
    /// @param expireAt The expiration timestamp of the signature.
    /// @param signature The signature to verify.
    error InvalidSignature(address wallet, uint256 expireAt, bytes signature);

    /// @notice Constructor
    /// @param messageSigner_ The message signer address.
    /// @param eduLandRewards The EDULandRewards contract address.
    /// @param forwarderRegistry The forwarder registry
    /// @dev emit a {MessageSignerSet} event.
    constructor(
        address messageSigner_,
        IEDULandRewards eduLandRewards,
        IForwarderRegistry forwarderRegistry
    ) ContractOwnership(msg.sender) ForwarderRegistryContext(forwarderRegistry) EIP712("EDULandRewardsKYC", "1.0") {
        EDU_LAND_REWARDS = eduLandRewards;

        messageSigner = messageSigner_;
        emit MessageSignerSet(messageSigner_);
    }

    /// @notice Add a KYC wallet with a signature.
    /// @dev Reverts with {ExpiredSignature} if the signature is expired.
    /// @dev Reverts with {InvalidSignature} if the signature is invalid.
    /// @dev Emits a {KycWalletsAdded} event.
    /// @param wallet The wallet address to add.
    /// @param expireAt The expiration timestamp of the signature.
    /// @param signature A EIP712 signature for the values `wallet` and `expireAt`.
    function addKycWalletWithSignature(address wallet, uint256 expireAt, bytes calldata signature) external {
        if (block.timestamp >= expireAt) {
            revert ExpiredSignature(wallet, expireAt, signature);
        }

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(ADD_KYC_WALLET_TYPEHASH, wallet, expireAt)));
        address recoveredSigner = digest.recover(signature);
        if (recoveredSigner != messageSigner) {
            revert InvalidSignature(wallet, expireAt, signature);
        }

        address[] memory wallets = new address[](1);
        wallets[0] = wallet;
        EDU_LAND_REWARDS.addKycWallets(wallets);
        emit KycWalletsAdded(wallets);
    }

    /// @notice Add KYC wallets by the operator.
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the operator role.
    /// @dev Emits a {KycWalletsAdded} event.
    /// @param wallets A list of wallet addresses to add.
    function addKycWallets(address[] calldata wallets) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        EDU_LAND_REWARDS.addKycWallets(wallets);
        emit KycWalletsAdded(wallets);
    }

    /// @notice Remove KYC wallets by the operator.
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the operator role.
    /// @dev Emits a {KycWalletsRemoved} event.
    /// @param wallets A list of wallet addresses to remove.
    function removeKycWallets(address[] calldata wallets) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        EDU_LAND_REWARDS.removeKycWallets(wallets);
        emit KycWalletsRemoved(wallets);
    }

    /// @notice Set the message signer address.
    /// @dev Reverts with {NotContractOwner} if the sender is not the contract owner.
    /// @dev Emits a {MessageSignerSet} event.
    function setMessageSigner(address messageSigner_) public {
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());
        messageSigner = messageSigner_;
        emit MessageSignerSet(messageSigner_);
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
