// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {InconsistentArrayLengths} from "@animoca/ethereum-contracts/contracts/CommonErrors.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {TokenRecovery} from "@animoca/ethereum-contracts/contracts/security/TokenRecovery.sol";
import {PauseStorage} from "@animoca/ethereum-contracts/contracts/lifecycle/libraries/PauseStorage.sol";
import {IPause} from "@animoca/ethereum-contracts/contracts/lifecycle/interfaces/IPause.sol";
import {ForwarderRegistryContext} from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {AccessControl} from "@animoca/ethereum-contracts/contracts/access/AccessControl.sol";
import {AccessControlStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/AccessControlStorage.sol";
import {IPoints} from "@animoca/anichess-ethereum-contracts-2.2.3/contracts/points/interface/IPoints.sol";

/// @title OCPointMerkleClaim
/// @notice This contract is designed for claiming OCPoint payouts which will cumulate over time.
/// @notice A merkle tree is generated with one leaf for each claim recipient together with a list of OCPoint amounts and deposit reason codes.
/// @notice Flow: when new claims become available, the contract is paused to avoid further claims, a new tree is generated by combining the current
/// @notice unclaimed payouts and the new payouts, per user. The new tree is set and replaces the previous one and the contract is unpaused.
contract OCPointMerkleClaim is AccessControl, TokenRecovery, ForwarderRegistryContext, IPause {
    /// @notice Thrown when the OCPoint contract address is invalid.
    /// @param invalidOCPointContractAddress The address of the invalid OCPoint contract.
    error InvalidOCPointContractAddress(address invalidOCPointContractAddress);

    /// @notice Thrown when trying to claim the same leaf more than once.
    /// @param recipient The recipient of the claim.
    /// @param amounts A list of OCPoint amount claimed.
    /// @param depositReasonCodes A list of deposit reason codes of the claim.
    /// @param treeCounter The treeCounter as when the claim was made.
    error AlreadyClaimed(address recipient, uint256[] amounts, bytes32[] depositReasonCodes, uint256 treeCounter);

    /// @notice Thrown when a proof cannot be verified.
    /// @param recipient The recipient of the claim.
    /// @param amounts A list of OCPoint amount claimed.
    /// @param depositReasonCodes A list of deposit reason codes of the claim.
    /// @param treeCounter The treeCounter as when the claim was made.
    error InvalidProof(address recipient, uint256[] amounts, bytes32[] depositReasonCodes, uint256 treeCounter);

    using AccessControlStorage for AccessControlStorage.Layout;
    using PauseStorage for PauseStorage.Layout;
    using MerkleProof for bytes32[];

    /// @notice The role identifier for the operator role.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice a reference to OCPoint contract
    IPoints public immutable OC_POINT;

    /// @notice Store the merkle root for claiming
    bytes32 public root;

    /// @notice A treeCounter is used for each new tree and is included in every leaf to prevent collisions with claims from previous trees.
    uint256 public treeCounter;

    /// @notice leaf hash to claimed state
    mapping(bytes32 => bool) public claimed;

    /// @notice Emitted when a new merkle root is set.
    /// @param root The new merkle root.
    event MerkleRootSet(bytes32 root);

    /// @notice Emitted when a payout is claimed.
    /// @param root The merkle root on which the claim was made.
    /// @param recipient The recipient of the claim.
    /// @param amounts The amounts of OCPoint claimed.
    /// @param depositReasonCodes The deposit reason codes of the claim.
    /// @param treeCounter The treeCounter as when the claim was made.
    event PayoutClaimed(bytes32 indexed root, address indexed recipient, uint256[] amounts, bytes32[] depositReasonCodes, uint256 treeCounter);

    /// @notice Constructor
    /// @param ocPointContractAddress The address of the OCPoint contract.
    /// @param forwarderRegistry The address of the forwarder registry.
    /// @dev Reverts with {InvalidOCPointContractAddress} if the OCPoint contract address is the zero address.
    /// @dev Emits a {Pause} event if `isPaused` is true.
    constructor(
        address ocPointContractAddress,
        IForwarderRegistry forwarderRegistry
    ) ContractOwnership(msg.sender) ForwarderRegistryContext(forwarderRegistry) {
        if (ocPointContractAddress == address(0)) {
            revert InvalidOCPointContractAddress(ocPointContractAddress);
        }
        OC_POINT = IPoints(ocPointContractAddress);
        PauseStorage.layout().constructorInit(true);
    }

    /// @notice Executes the payout for a given recipient address (anyone can call this function).
    /// @dev Reverts with {Paused} if the contract is paused.
    /// @dev Reverts with {InconsistentArrayLengths} for inconsistent amounts and depositReasonCodes length.
    /// @dev Reverts with {AlreadyClaimed} if this specific payout has already been claimed.
    /// @dev Reverts with {InvalidProof} if the merkle proof has failed the verification
    /// @dev Emits a {PayoutClaimed} event.
    /// @param recipient The recipient for this claim.
    /// @param amounts A list of OCPoint amount to be claimed.
    /// @param depositReasonCodes  A list of deposit reason codes for this claim.
    /// @param proof The Merkle proof of the user based on the merkle root
    function claimPayout(address recipient, uint256[] calldata amounts, bytes32[] calldata depositReasonCodes, bytes32[] calldata proof) external {
        PauseStorage.layout().enforceIsNotPaused();

        if (amounts.length != depositReasonCodes.length) {
            revert InconsistentArrayLengths();
        }

        bytes32 currentRoot = root;
        uint256 currentTreeCounter = treeCounter;

        bytes32 leaf = keccak256(abi.encodePacked(recipient, amounts, depositReasonCodes, currentTreeCounter));
        if (claimed[leaf]) {
            revert AlreadyClaimed(recipient, amounts, depositReasonCodes, currentTreeCounter);
        }
        if (!proof.verifyCalldata(currentRoot, leaf)) {
            revert InvalidProof(recipient, amounts, depositReasonCodes, currentTreeCounter);
        }

        claimed[leaf] = true;
        for (uint256 i; i < amounts.length; ++i) {
            OC_POINT.deposit(recipient, amounts[i], depositReasonCodes[i]);
        }

        emit PayoutClaimed(currentRoot, recipient, amounts, depositReasonCodes, currentTreeCounter);
    }

    /// @notice Pauses the contract.
    /// @dev Reverts with {NotRoleHolder} if the sender is not the contract operator.
    /// @dev Reverts with {Paused} if the contract is paused.
    /// @dev Emits a {Pause} event.
    function pause() public {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        PauseStorage.layout().pause();
    }

    /// @notice Unpauses the contract.
    /// @dev Reverts with {NotRoleHolder} if the sender is not the contract operator.
    /// @dev Reverts with {NotPaused} if the contract is not paused.
    /// @dev Emits a {Unpause} event.
    function unpause() public {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        PauseStorage.layout().unpause();
    }

    /// @notice Sets the new merkle root for claiming, unpauses if already paused and increments the treeCounter.
    /// @dev Reverts with {NotRoleHolder} if the sender is not the contract operator.
    /// @dev Reverts with {NotPaused} if the contract is not paused.
    /// @dev Emits a {Unpause} event.
    /// @dev Emits a {MerkleRootSet} event.
    /// @param merkleRoot The merkle root to set.
    function setMerkleRoot(bytes32 merkleRoot) public {
        unpause();

        root = merkleRoot;
        unchecked {
            ++treeCounter;
        }
        emit MerkleRootSet(merkleRoot);
    }

    /// @inheritdoc IPause
    function paused() external view returns (bool) {
        return PauseStorage.layout().paused();
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