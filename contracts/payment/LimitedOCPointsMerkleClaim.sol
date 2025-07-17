// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {InconsistentArrayLengths} from "@animoca/ethereum-contracts/contracts/CommonErrors.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {ContractOwnershipStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/ContractOwnershipStorage.sol";
import {TokenRecovery} from "@animoca/ethereum-contracts/contracts/security/TokenRecovery.sol";
import {ForwarderRegistryContext} from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {IPoints} from "@animoca/anichess-ethereum-contracts-2.2.3/contracts/points/interface/IPoints.sol";

/// @title LimitedOCPointsMerkleClaim
/// @notice This contract is designed for claiming reward tokens from a limited pool within fixed time epochs.
/// @notice Each epoch has a fixed total amount that gets depleted as users claim their allocations.
/// @notice Claims are based on merkle proofs and are subject to time constraints and pool availability.
contract LimitedOCPointsMerkleClaim is TokenRecovery, ForwarderRegistryContext {
    /// @notice Thrown when the reward contract address is invalid.
    /// @param InvalidPointsContractAddress The address of the invalid points contract.
    error InvalidPointsContractAddress(address InvalidPointsContractAddress);

    /// @notice Thrown when trying to claim outside the valid time epoch.
    /// @param currentTime The current block timestamp.
    /// @param startTime The start time of the claiming epoch.
    /// @param endTime The end time of the claiming epoch.
    error ClaimingEpochNotActive(uint256 currentTime, uint256 startTime, uint256 endTime);

    /// @notice Thrown when trying to claim the same allocation more than once.
    /// @param recipient The recipient of the claim.
    /// @param amount The amount being claimed.
    /// @param reasonCode The reason code for the deposit.
    /// @param epochId The epoch identifier for a specific claiming epoch.
    error AlreadyClaimed(address recipient, uint256 amount, bytes32 reasonCode, uint256 epochId);

    /// @notice Thrown when a proof cannot be verified.
    /// @param recipient The recipient of the claim.
    /// @param amount The amount being claimed.
    /// @param reasonCode The reason code for the deposit.
    /// @param epochId The epoch identifier for a specific claiming epoch.
    error InvalidProof(address recipient, uint256 amount, bytes32 reasonCode, uint256 epochId);

    /// @notice Thrown when the pool doesn't have enough tokens for the claim.
    /// @param amountRequested The amount requested to claim.
    /// @param amountAvailable The amount available in the pool.
    error InsufficientPoolAmount(uint256 amountRequested, uint256 amountAvailable);

    /// @notice Thrown when trying to access a non-existent epoch.
    /// @param epochId The epoch identifier for a specific claiming epoch.
    error ClaimEpochNotFound(uint256 epochId);

    /// @notice Thrown when the start time is not before the end time.
    /// @param startTime The start time.
    /// @param endTime The end time.
    error InvalidClaimWindow(uint256 startTime, uint256 endTime);

    /// @notice Enum representing different claim validation errors.
    enum ClaimError {
        NoError,
        ClaimEpochNotFound,
        ClaimingEpochNotActive,
        AlreadyClaimed,
        InsufficientPoolAmount
    }

    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;
    using MerkleProof for bytes32[];

    /// @notice A reference to the points contract.
    IPoints public immutable POINTS_CONTRACT;

    /// @notice Struct representing a claiming epoch.
    struct ClaimEpoch {
        bytes32 merkleRoot;      // Merkle root for this epoch
        uint256 totalAmount;     // Total amount available for claiming
        uint256 amountLeft;      // Amount left to be claimed
        uint256 startTime;       // Start time for claiming
        uint256 endTime;         // End time for claiming
    }

    /// @notice Current epoch counter.
    uint256 public currentEpochId;

    /// @notice Mapping from epoch ID to claiming epoch data.
    mapping(uint256 => ClaimEpoch) public claimEpochs;

    /// @notice Mapping from leaf hash to claimed status.
    mapping(bytes32 => bool) public claimed;

    /// @notice Emitted when a new merkle root is set for an epoch.
    /// @param epochId The epoch identifier for a specific claiming epoch.
    /// @param merkleRoot The merkle root for this epoch.
    /// @param totalAmount The total amount available for claiming.
    /// @param startTime The start time for claiming.
    /// @param endTime The end time for claiming.
    event MerkleRootSet(uint256 indexed epochId, bytes32 indexed merkleRoot, uint256 totalAmount, uint256 startTime, uint256 endTime);

    /// @notice Emitted when a points is claimed.
    /// @param epochId The epoch identifier for a specific claiming epoch.
    /// @param merkleRoot The merkle root for this epoch.
    /// @param recipient The recipient of the claim.
    /// @param amount The amount claimed.
    /// @param amountLeft The amount left in the pool after this claim.
    event PointsClaimed(uint256 indexed epochId, bytes32 indexed merkleRoot, address indexed recipient, uint256 amount, uint256 amountLeft);

    /// @notice Constructor for limited OC points merkle claim.
    /// @param pointsContractAddress The address of the points contract.
    /// @param forwarderRegistry The address of the forwarder registry.
    /// @dev Reverts with {InvalidPointsContractAddress} if the points contract address is the zero address.
    constructor(
        address pointsContractAddress,
        IForwarderRegistry forwarderRegistry
    ) ContractOwnership(msg.sender) ForwarderRegistryContext(forwarderRegistry) {
        if (pointsContractAddress == address(0)) {
            revert InvalidPointsContractAddress(pointsContractAddress);
        }
        POINTS_CONTRACT = IPoints(pointsContractAddress);
    }

    /// @notice Sets a new merkle root for a epoch with a limited reward pool and time constraints.
    /// @dev Reverts with {NotContractOwner} if the sender is not the contract owner.
    /// @dev Reverts with {InvalidClaimWindow} if the end time is not after the start time and the end time is in the past.
    /// @dev Emits a {MerkleRootSet} event.
    /// @param merkleRoot The merkle root for this epoch.
    /// @param totalAmount The total amount available for claiming in this epoch.
    /// @param startTime The start time for claiming.
    /// @param endTime The end time for claiming.
    function setMerkleRoot(
        bytes32 merkleRoot,
        uint256 totalAmount,
        uint256 startTime,
        uint256 endTime
    ) external {
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());
        
        if (startTime >= endTime || endTime <= block.timestamp) {
            revert InvalidClaimWindow(startTime, endTime);
        }

        uint256 epochId = currentEpochId;
        claimEpochs[epochId] = ClaimEpoch({
            merkleRoot: merkleRoot,
            totalAmount: totalAmount,
            amountLeft: totalAmount,
            startTime: startTime,
            endTime: endTime
        });

        unchecked {
            ++currentEpochId;
        }

        emit MerkleRootSet(epochId, merkleRoot, totalAmount, startTime, endTime);
    }

    /// @notice Claims points for a specific epoch and given recipient address.
    /// @dev Reverts with {ClaimEpochNotFound} if the epoch doesn't exist.
    /// @dev Reverts with {ClaimingEpochNotActive} if the current time is outside the claiming epoch.
    /// @dev Reverts with {AlreadyClaimed} if the user has already claimed for this epoch.
    /// @dev Reverts with {InvalidProof} if the merkle proof verification fails.
    /// @dev Reverts with {InsufficientPoolAmount} if the pool doesn't have enough tokens.
    /// @dev Emits a {PointsClaimed} event.
    /// @param epochId The epoch identifier for a specific claiming epoch.
    /// @param recipient The recipient for the points.
    /// @param amount The amount of points to be claimed.
    /// @param reasonCode The reason code for the deposit.
    /// @param proof The merkle proof for verification.
    function claim(
        uint256 epochId,
        address recipient,
        uint256 amount,
        bytes32 reasonCode,
        bytes32[] calldata proof
    ) external {
        ClaimEpoch storage epoch = claimEpochs[epochId];
        
        if (epoch.merkleRoot == bytes32(0)) {
            revert ClaimEpochNotFound(epochId);
        }

        uint256 currentTime = block.timestamp;
        if (currentTime < epoch.startTime || currentTime > epoch.endTime) {
            revert ClaimingEpochNotActive(currentTime, epoch.startTime, epoch.endTime);
        }

        bytes32 leaf = keccak256(abi.encodePacked(recipient, amount, reasonCode, epochId));
        
        if (claimed[leaf]) {
            revert AlreadyClaimed(recipient, amount, reasonCode, epochId);
        }

        if (epoch.amountLeft < amount) {
            revert InsufficientPoolAmount(amount, epoch.amountLeft);
        }

        if (!proof.verifyCalldata(epoch.merkleRoot, leaf)) {
            revert InvalidProof(recipient, amount, reasonCode, epochId);
        }

        claimed[leaf] = true;
        epoch.amountLeft -= amount;

        POINTS_CONTRACT.deposit(recipient, amount, reasonCode);

        emit PointsClaimed(epochId, epoch.merkleRoot, recipient, amount, epoch.amountLeft);
    }

    /// @notice Checks if a user can claim rewards for a given epoch.
    /// @dev Returns ClaimError.ClaimEpochNotFound if the epoch doesn't exist.
    /// @dev Returns ClaimError.ClaimingEpochNotActive if the current time is outside the claiming epoch.
    /// @dev Returns ClaimError.AlreadyClaimed if the user has already claimed for this epoch.
    /// @dev Returns ClaimError.InsufficientPoolAmount if the pool doesn't have enough tokens.
    /// @dev Returns ClaimError.NoError if basic validation passes.
    /// @param epochId The epoch identifier for a specific claiming epoch.
    /// @param recipient The recipient address.
    /// @param amount The amount to be claimed.
    /// @param reasonCode The reason code for the deposit.
    /// @return error The claim validation result.
    function canClaim(
        uint256 epochId,
        address recipient,
        uint256 amount,
        bytes32 reasonCode
    ) external view returns (ClaimError) {
        ClaimEpoch storage epoch = claimEpochs[epochId];
        
        if (epoch.merkleRoot == bytes32(0)) {
            return ClaimError.ClaimEpochNotFound;
        }

        uint256 currentTime = block.timestamp;
        if (currentTime < epoch.startTime || currentTime > epoch.endTime) {
            return ClaimError.ClaimingEpochNotActive;
        }

        bytes32 leaf = keccak256(abi.encodePacked(recipient, amount, reasonCode, epochId));
        
        if (claimed[leaf]) {
            return ClaimError.AlreadyClaimed;
        }

        if (epoch.amountLeft < amount) {
            return ClaimError.InsufficientPoolAmount;
        }

        return ClaimError.NoError;
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