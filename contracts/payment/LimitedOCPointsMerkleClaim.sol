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
/// @notice This contract is designed for claiming reward tokens from a limited allocation within fixed time epochs.
/// @notice Each epoch has a fixed total amount that gets depleted as users claim their allocations.
/// @notice Claims are based on merkle proofs and are subject to time constraints and allocation availability.
/// @notice Each distributor can manage their own allocation.
contract LimitedOCPointsMerkleClaim is AccessControl, TokenRecovery, ForwarderRegistryContext {
    using AccessControlStorage for AccessControlStorage.Layout;
    using MerkleProof for bytes32[];

    /// @notice The role identifier for the admin role.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice A reference to the points contract.
    IPoints public immutable POINTS_CONTRACT;

    /// @notice Struct to store epoch data
    struct EpochData {
        bytes32 root;
        uint256 nonce;
        uint256 startTime;
        uint256 endTime;
    }

    /// @notice Mapping from leaf hash to claimed status.
    mapping(bytes32 => bool) public claimed;

    /// @notice Mapping from distributor address to their epoch data.
    mapping(address => EpochData) public epochs;

    /// @notice Mapping from distributor address to their allocation.
    mapping(address => uint256) public allocations;

    /// @notice Mapping from distributor address to their amount consumed from the allocation.
    mapping(address => uint256) public consumed;

    /// @notice Enum representing different claim validation errors.
    enum ClaimError {
        NoError,
        MerkleRootNotSet,
        ClaimNotActive,
        AlreadyClaimed,
        InvalidProof,
        InsufficientAllocation
    }

    /// @notice Emitted when a new merkle root.
    /// @param distributorAddress The distributor address that set the root.
    /// @param merkleRoot The merkle root.
    /// @param nonce The nonce for the epoch.
    /// @param claimablePoints The allocation available for claiming.
    /// @param startTime The start time for claiming.
    /// @param endTime The end time for claiming.
    event MerkleRootSet(address indexed distributorAddress, bytes32 indexed merkleRoot, uint256 nonce, uint256 claimablePoints, uint256 startTime, uint256 endTime);

    /// @notice Emitted when a points is claimed.
    /// @param distributorAddress The distributor address whose allocation was claimed from.
    /// @param merkleRoot The merkle root.
    /// @param recipient The recipient of the claim.
    /// @param nonce The nonce for the epoch.
    /// @param amount The amount claimed.
    /// @param amountLeft The amount left in the allocation after this claim.
    event PointsClaimed(address indexed distributorAddress, bytes32 indexed merkleRoot, address indexed recipient, uint256 nonce, uint256 amount, uint256 amountLeft);

    /// @notice Emitted when the allocation size is updated.
    /// @param distributorAddress The distributor address whose allocation was updated.
    /// @param oldAllocation The old allocation size.
    /// @param newAllocation The new allocation size.
    event AllocationUpdated(address indexed distributorAddress, uint256 oldAllocation, uint256 newAllocation);

    /// @notice Thrown when the reward contract address is invalid.
    /// @param InvalidPointsContractAddress The address of the invalid points contract.
    error InvalidPointsContractAddress(address InvalidPointsContractAddress);

    /// @notice Thrown when trying to claim outside the valid time epoch.
    /// @param currentTime The current block timestamp.
    /// @param startTime The start time of the claiming epoch.
    /// @param endTime The end time of the claiming epoch.
    error ClaimNotActive(uint256 currentTime, uint256 startTime, uint256 endTime);

    /// @notice Thrown when trying to claim the same allocation more than once.
    /// @param distributorAddress The distributor address.
    /// @param nonce The nonce for the epoch.
    /// @param recipient The recipient of the claim.
    /// @param amount The amount being claimed.
    /// @param reasonCode The reason code for the deposit.
    error AlreadyClaimed(address distributorAddress, uint256 nonce, address recipient, uint256 amount, bytes32 reasonCode);

    /// @notice Thrown when a proof cannot be verified.
    /// @param distributorAddress The distributor address.
    /// @param nonce The nonce for the epoch.
    /// @param recipient The recipient of the claim.
    /// @param amount The amount being claimed.
    /// @param reasonCode The reason code for the deposit.
    error InvalidProof(address distributorAddress, uint256 nonce, address recipient, uint256 amount, bytes32 reasonCode);

    /// @notice Thrown when the allocation doesn't have enough points for the claim.
    /// @param claimAmount The amount requested to claim.
    /// @param allocationAmount The amount available in the allocation.
    error InsufficientAllocation(uint256 claimAmount, uint256 allocationAmount);

    /// @notice Thrown when trying to claim before a merkle root is set.
    /// @param distributorAddress The distributor address.
    error MerkleRootNotSet(address distributorAddress);

    /// @notice Thrown when the claim window is invalid.
    /// @param startTime The start time.
    /// @param endTime The end time.
    error InvalidClaimWindow(uint256 startTime, uint256 endTime);

    /// @notice Thrown when the merkle root is zero.
    error MerkleRootCannotBeZero();

    /// @notice Thrown when incremental amount to the allocation is invalid.
    /// @param amount The amount to be added to the allocation.
    error InvalidAllocationSize(uint256 amount);

    /// @notice Thrown when a distributor has no allocation.
    /// @param distributorAddress The distributor address that has no allocation.
    error NoAllocation(address distributorAddress);

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

    /// @notice Sets a new merkle root with a limited reward allocation and time constraints for a distributor.
    /// @dev Reverts with {NoAllocation} if the distributor has no allocation.
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
        address distributorAddress = _msgSender();
        uint256 allocation = allocations[distributorAddress];
        uint256 amountConsumed = consumed[distributorAddress];
        
        if (allocation == 0 || allocation - amountConsumed == 0) {
            revert NoAllocation(distributorAddress);
        }
        
        if (startTime_ >= endTime_ || endTime_ <= block.timestamp) {
            revert InvalidClaimWindow(startTime_, endTime_);
        }

        if (merkleRoot == bytes32(0)) {
            revert MerkleRootCannotBeZero();
        }

        EpochData storage epochData = epochs[distributorAddress];
        epochData.root = merkleRoot;
        epochData.startTime = startTime_;
        epochData.endTime = endTime_;

        unchecked {
            epochData.nonce++;
        }

        emit MerkleRootSet(distributorAddress, merkleRoot, epochData.nonce, allocation - amountConsumed, startTime_, endTime_);
    }

    /// @notice Claims points for a given recipient address from a specific distributor's allocation.
    /// @dev Reverts with {MerkleRootNotSet} if the merkle root is not set for the distributor.
    /// @dev Reverts with {ClaimNotActive} if the current time is outside the claiming window.
    /// @dev Reverts with {AlreadyClaimed} if the user has already claimed.
    /// @dev Reverts with {InvalidProof} if the merkle proof verification fails.
    /// @dev Reverts with {InsufficientAllocation} if the allocation doesn't have enough points.
    /// @dev Emits a {PointsClaimed} event.
    /// @param distributorAddress The distributor address whose allocation to claim from.
    /// @param recipient The recipient of the claim.
    /// @param amount The amount of points to be claimed.
    /// @param proof The merkle proof for verification.
    function claim(
        address distributorAddress,
        address recipient,
        uint256 amount,
        bytes32[] calldata proof
    ) external {
        EpochData storage epochData = epochs[distributorAddress];
        ClaimError error = _canClaim(distributorAddress, recipient, amount, epochData);
        bytes32 reasonCode = keccak256(abi.encodePacked("LIMITED_POINTS_CLAIM_", distributorAddress));

        if (error == ClaimError.MerkleRootNotSet) {
            revert MerkleRootNotSet(distributorAddress);
        } else if (error == ClaimError.ClaimNotActive) {
            revert ClaimNotActive(block.timestamp, epochData.startTime, epochData.endTime);
        } else if (error == ClaimError.InsufficientAllocation) {
            uint256 allocation = allocations[distributorAddress];
            uint256 amountConsumed = consumed[distributorAddress];
            revert InsufficientAllocation(amount, allocation - amountConsumed);
        } else if (error == ClaimError.AlreadyClaimed) {
            revert AlreadyClaimed(distributorAddress, epochData.nonce, recipient, amount, reasonCode);
        }

        bytes32 leaf = keccak256(abi.encodePacked(epochData.nonce, recipient, amount, reasonCode));
        
        if (!proof.verifyCalldata(epochData.root, leaf)) {
            revert InvalidProof(distributorAddress, epochData.nonce, recipient, amount, reasonCode);
        }

        claimed[leaf] = true;
        consumed[distributorAddress] += amount;
        uint256 amountLeft = allocations[distributorAddress] - consumed[distributorAddress];

        POINTS_CONTRACT.deposit(recipient, amount, reasonCode);

        emit PointsClaimed(distributorAddress, epochData.root, recipient, epochData.nonce, amount, amountLeft);
    }

    /// @notice Checks if a user can claim rewards from a specific distributor's allocation.
    /// @dev Returns ClaimError.MerkleRootNotSet if the merkle root is not set.
    /// @dev Returns ClaimError.ClaimNotActive if the current time is outside the claiming window.
    /// @dev Returns ClaimError.InsufficientAllocation if the allocation doesn't have enough points.
    /// @dev Returns ClaimError.AlreadyClaimed if the user has already claimed.
    /// @dev Returns ClaimError.NoError if basic validation passes.
    /// @param distributorAddress The distributor address whose allocation to check.
    /// @param recipient The recipient address.
    /// @param amount The amount to be claimed.
    /// @return error The claim validation result.
    function canClaim(
        address distributorAddress,
        address recipient,
        uint256 amount
    ) external view returns (ClaimError) {
        EpochData storage epochData = epochs[distributorAddress];
        return _canClaim(distributorAddress, recipient, amount, epochData);
    }

    /// @notice Internal function to validate claim conditions.
    /// @dev Returns ClaimError.MerkleRootNotSet if the merkle root is not set.
    /// @dev Returns ClaimError.ClaimNotActive if the current time is outside the claiming window.
    /// @dev Returns ClaimError.InsufficientAllocation if the allocation doesn't have enough points.
    /// @dev Returns ClaimError.AlreadyClaimed if the user has already claimed.
    /// @dev Returns ClaimError.NoError if basic validation passes.
    /// @param distributorAddress The distributor address whose allocation to check.
    /// @param recipient The recipient address.
    /// @param amount The amount to be claimed.
    /// @param epochData The epoch data storage reference.
    /// @return error The claim validation result.
    function _canClaim(
        address distributorAddress,
        address recipient,
        uint256 amount,
        EpochData storage epochData
    ) internal view returns (ClaimError) {
        if (epochData.root == bytes32(0)) {
            return ClaimError.MerkleRootNotSet;
        }

        uint256 currentTime = block.timestamp;
        if (currentTime < epochData.startTime || currentTime > epochData.endTime) {
            return ClaimError.ClaimNotActive;
        }

        uint256 allocation = allocations[distributorAddress];
        uint256 amountConsumed = consumed[distributorAddress];
        if (allocation - amountConsumed < amount) {
            return ClaimError.InsufficientAllocation;
        }

        bytes32 reasonCode = keccak256(abi.encodePacked("LIMITED_POINTS_CLAIM_", distributorAddress));
        bytes32 leaf = keccak256(abi.encodePacked(epochData.nonce, recipient, amount, reasonCode));

        if (claimed[leaf]) {
            return ClaimError.AlreadyClaimed;
        }

        return ClaimError.NoError;
    }

    /// @notice Increases the allocation size for a specific distributor address by adding the specified amount.
    /// @dev Reverts with {NotRoleHolder} if the sender is not the contract admin.
    /// @dev Reverts with {InvalidAllocationSize} if incremental amount is zero.
    /// @dev Emits a {AllocationUpdated} event.
    /// @param distributorAddress The distributor address whose allocation to increase.
    /// @param amount The amount to add to the current allocation size.
    function increaseAllocation(address distributorAddress, uint256 amount) external {
        AccessControlStorage.layout().enforceHasRole(ADMIN_ROLE, _msgSender());
                
        if (amount == 0) {
            revert InvalidAllocationSize(amount);
        }
        
        uint256 oldAllocation = allocations[distributorAddress];
        allocations[distributorAddress] += amount;

        emit AllocationUpdated(distributorAddress, oldAllocation, allocations[distributorAddress]);
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