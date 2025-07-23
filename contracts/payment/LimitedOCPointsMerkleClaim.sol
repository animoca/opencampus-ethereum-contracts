// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {TokenRecovery} from "@animoca/ethereum-contracts/contracts/security/TokenRecovery.sol";
import {ForwarderRegistryContext} from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {IPoints} from "@animoca/anichess-ethereum-contracts-2.2.3/contracts/points/interface/IPoints.sol";
import {AccessControl} from "@animoca/ethereum-contracts/contracts/access/AccessControl.sol";
import {AccessControlStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/AccessControlStorage.sol";

/// @title LimitedOCPointsMerkleClaim
/// @notice This contract is designed for claiming reward tokens from a limited pool within fixed time epochs.
/// @notice Each epoch has a fixed total amount that gets depleted as users claim their allocations.
/// @notice Claims are based on merkle proofs and are subject to time constraints and pool availability.
contract LimitedOCPointsMerkleClaim is AccessControl, TokenRecovery, ForwarderRegistryContext {
    /// @notice Thrown when the reward contract address is invalid.
    /// @param InvalidPointsContractAddress The address of the invalid points contract.
    error InvalidPointsContractAddress(address InvalidPointsContractAddress);

    /// @notice Thrown when trying to claim outside the valid time epoch.
    /// @param currentTime The current block timestamp.
    /// @param startTime The start time of the claiming epoch.
    /// @param endTime The end time of the claiming epoch.
    error ClaimNotActive(uint256 currentTime, uint256 startTime, uint256 endTime);

    /// @notice Thrown when trying to claim the same allocation more than once.
    /// @param nonce The nonce for the pool.
    /// @param recipient The recipient of the claim.
    /// @param amount The amount being claimed.
    /// @param reasonCode The reason code for the deposit.
    error AlreadyClaimed(uint256 nonce, address recipient, uint256 amount, bytes32 reasonCode);

    /// @notice Thrown when a proof cannot be verified.
    /// @param nonce The nonce for the pool.
    /// @param recipient The recipient of the claim.
    /// @param amount The amount being claimed.
    /// @param reasonCode The reason code for the deposit.
    error InvalidProof(uint256 nonce, address recipient, uint256 amount, bytes32 reasonCode);

    /// @notice Thrown when the pool doesn't have enough points for the claim.
    /// @param claimAmount The amount requested to claim.
    /// @param poolAmount The amount available in the pool.
    error InsufficientPoolAmount(uint256 claimAmount, uint256 poolAmount);

    /// @notice Thrown when trying to claim before a merkle root is set.
    error MerkleRootNotSet();

    /// @notice Thrown when the claim window is invalid.
    /// @param startTime The start time.
    /// @param endTime The end time.
    error InvalidClaimWindow(uint256 startTime, uint256 endTime);

    /// @notice Thrown when the merkle root is zero.
    error MerkleRootCannotBeZero();

    /// @notice Thrown when incremental amount to the pool is invalid.
    /// @param amount The amount to be added to the pool.
    error InvalidPoolSize(uint256 amount);

    /// @notice Enum representing different claim validation errors.
    enum ClaimError {
        NoError,
        MerkleRootNotSet,
        ClaimNotActive,
        AlreadyClaimed,
        InvalidProof,
        InsufficientPoolAmount
    }

    using AccessControlStorage for AccessControlStorage.Layout;
    using MerkleProof for bytes32[];

    /// @notice The role identifier for the distributor role.
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    /// @notice The role identifier for the admin role.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice A reference to the points contract.
    IPoints public immutable POINTS_CONTRACT;

    /// @notice The reason code for the points deposit.
    bytes32 public immutable POINTS_DEPOSIT_REASON_CODE;

    /// @notice Mapping from leaf hash to claimed status.
    mapping(bytes32 => bool) public claimed;

    /// @notice The size of the pool.
    uint256 public poolSize;

    /// @notice The amount claimed from the pool.
    uint256 public amountClaimed = 0;

    /// @notice The nonce for the pool.
    uint256 public nonce = 0;

    /// @notice The merkle root for the pool.
    bytes32 public root;

    /// @notice The start time for the pool.
    uint256 public startTime;

    /// @notice The end time for the pool.
    uint256 public endTime;

    /// @notice Emitted when a new merkle root.
    /// @param nonce The nonce for the pool.
    /// @param merkleRoot The merkle root.
    /// @param poolSize The pool size available for claiming.
    /// @param startTime The start time for claiming.
    /// @param endTime The end time for claiming.
    event MerkleRootSet(uint256 indexed nonce, bytes32 indexed merkleRoot, uint256 poolSize, uint256 startTime, uint256 endTime);

    /// @notice Emitted when a points is claimed.
    /// @param nonce The nonce for the pool.
    /// @param merkleRoot The merkle root.
    /// @param recipient The recipient of the claim.
    /// @param amount The amount claimed.
    /// @param amountLeft The amount left in the pool after this claim.
    event PointsClaimed(uint256 indexed nonce, bytes32 indexed merkleRoot, address indexed recipient, uint256 amount, uint256 amountLeft);

    /// @notice Emitted when the pool size is updated.
    /// @param oldPoolSize The old pool size.
    /// @param newPoolSize The new pool size.
    event PoolSizeUpdated(uint256 oldPoolSize, uint256 newPoolSize);

    /// @notice Constructor for limited OC points merkle claim.
    /// @param pointsContractAddress The address of the points contract.
    /// @param poolSize_ The initial pool size.
    /// @param pointsDepositReasonCode The reason code for points deposits.
    /// @param forwarderRegistry The address of the forwarder registry.
    /// @dev Reverts with {InvalidPointsContractAddress} if the points contract address is the zero address.
    constructor(
        address pointsContractAddress,
        uint256 poolSize_,
        bytes32 pointsDepositReasonCode,
        IForwarderRegistry forwarderRegistry
    ) ContractOwnership(msg.sender) ForwarderRegistryContext(forwarderRegistry) {
        if (pointsContractAddress == address(0)) {
            revert InvalidPointsContractAddress(pointsContractAddress);
        }
        POINTS_CONTRACT = IPoints(pointsContractAddress);
        poolSize = poolSize_;
        POINTS_DEPOSIT_REASON_CODE = pointsDepositReasonCode;
    }

    /// @notice Sets a new merkle root with a limited reward pool and time constraints.
    /// @dev Reverts with {NotRoleHolder} if the sender is not the contract distributor.
    /// @dev Reverts with {InvalidClaimWindow} if the claim window is invalid.
    /// @dev Reverts with {MerkleRootCannotBeZero} if the merkle root is zero.
    /// @dev Emits a {MerkleRootSet} event.
    /// @param merkleRoot The merkle root.
    /// @param startTime_ The start time for claiming.
    /// @param endTime_ The end time for claiming.
    function setMerkleRoot(
        bytes32 merkleRoot,
        uint256 startTime_,
        uint256 endTime_
    ) external {
        AccessControlStorage.layout().enforceHasRole(DISTRIBUTOR_ROLE, _msgSender());
        
        if (startTime_ >= endTime_ || endTime_ <= block.timestamp) {
            revert InvalidClaimWindow(startTime_, endTime_);
        }

        if (merkleRoot == bytes32(0)) {
            revert MerkleRootCannotBeZero();
        }

        root = merkleRoot;
        startTime = startTime_;
        endTime = endTime_;

        unchecked {
            nonce++;
        }

        emit MerkleRootSet(nonce, merkleRoot, poolSize - amountClaimed, startTime_, endTime_);
    }

    /// @notice Claims points for a given recipient address.
    /// @dev Reverts with {ClaimNotActive} if the current time is outside the claiming window.
    /// @dev Reverts with {AlreadyClaimed} if the user has already claimed.
    /// @dev Reverts with {InvalidProof} if the merkle proof verification fails.
    /// @dev Reverts with {InsufficientPoolAmount} if the pool doesn't have enough points.
    /// @dev Emits a {PointsClaimed} event.
    /// @param recipient The recipient of the claim.
    /// @param amount The amount of points to be claimed.
    /// @param proof The merkle proof for verification.
    function claim(
        address recipient,
        uint256 amount,
        bytes32[] calldata proof
    ) external {
        if (root == bytes32(0)) {
            revert MerkleRootNotSet();
        }

        uint256 currentTime = block.timestamp;
        if (currentTime < startTime || currentTime > endTime) {
            revert ClaimNotActive(currentTime, startTime, endTime);
        }

        uint256 amountLeft = poolSize - amountClaimed;
        if (amountLeft < amount) {
            revert InsufficientPoolAmount(amount, amountLeft);
        }

        bytes32 leaf = keccak256(abi.encodePacked(nonce, recipient, amount, POINTS_DEPOSIT_REASON_CODE));
        
        if (claimed[leaf]) {
            revert AlreadyClaimed(nonce, recipient, amount, POINTS_DEPOSIT_REASON_CODE);
        }

        if (!proof.verifyCalldata(root, leaf)) {
            revert InvalidProof(nonce, recipient, amount, POINTS_DEPOSIT_REASON_CODE);
        }

        claimed[leaf] = true;
        amountClaimed += amount;

        POINTS_CONTRACT.deposit(recipient, amount, POINTS_DEPOSIT_REASON_CODE);

        emit PointsClaimed(nonce, root, recipient, amount, amountLeft - amount);
    }

    /// @notice Checks if a user can claim rewards.
    /// @dev Returns ClaimError.MerkleRootNotSet if the merkle root is not set.
    /// @dev Returns ClaimError.ClaimNotActive if the current time is outside the claiming window.
    /// @dev Returns ClaimError.AlreadyClaimed if the user has already claimed.
    /// @dev Returns ClaimError.InvalidProof if the merkle proof verification fails.
    /// @dev Returns ClaimError.InsufficientPoolAmount if the pool doesn't have enough points.
    /// @dev Returns ClaimError.NoError if basic validation passes.
    /// @param recipient The recipient address.
    /// @param amount The amount to be claimed.
    /// @param proof The merkle proof for verification.
    /// @return error The claim validation result.
    function canClaim(
        address recipient,
        uint256 amount,
        bytes32[] calldata proof
    ) external view returns (ClaimError) {
        if (root == bytes32(0)) {
            return ClaimError.MerkleRootNotSet;
        }

        uint256 currentTime = block.timestamp;
        if (currentTime < startTime || currentTime > endTime) {
            return ClaimError.ClaimNotActive;
        }

        bytes32 leaf = keccak256(abi.encodePacked(nonce, recipient, amount, POINTS_DEPOSIT_REASON_CODE));
        
        if (poolSize - amountClaimed < amount) {
            return ClaimError.InsufficientPoolAmount;
        }

        if (claimed[leaf]) {
            return ClaimError.AlreadyClaimed;
        }

        if (!proof.verifyCalldata(root, leaf)) {
            return ClaimError.InvalidProof;
        }

        return ClaimError.NoError;
    }

    /// @notice Increases the pool size by adding the specified amount.
    /// @dev Reverts with {NotRoleHolder} if the sender is not the contract admin.
    /// @dev Reverts with {InvalidPoolSize} if incremental amount is zero.
    /// @dev Emits a {PoolSizeUpdated} event.
    /// @param amount The amount to add to the current pool size.
    function increasePoolSize(uint256 amount) external {
        AccessControlStorage.layout().enforceHasRole(ADMIN_ROLE, _msgSender());
                
        if (amount == 0) {
            revert InvalidPoolSize(amount);
        }
        
        uint256 oldPoolSize = poolSize;
        poolSize += amount;

        emit PoolSizeUpdated(oldPoolSize, poolSize);
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