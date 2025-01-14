// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.22;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {NodeRewardsBase} from "@gelatonetwork/node-sale-rewards/contracts/NodeRewardsBase.sol";
import {RewardsKYC} from "@gelatonetwork/node-sale-rewards/contracts/RewardsKYC.sol";

contract EDULandRewards is NodeRewardsBase, RewardsKYC {
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant REWARDS_CONTROLLER_ROLE = keccak256("REWARDS_CONTROLLER_ROLE");
    uint256 public immutable MAX_REWARD_TIME_WINDOW;

    uint256 public rewardPerSecond;

    /// @notice batchNumber => reward per land
    mapping(uint256 => uint256) public rewardPerLandOfBatch;
    /// @notice batchNumber => tokenId => recipient
    mapping(uint256 => mapping(uint256 => address)) public rewardsRecipients;

    /// @notice Emitted when rewardPerSecond is updated.
    event RewardPerSecondUpdated(uint256 rewardPerSecond);

    /// @notice Emitted when batch is finalized.
    event BatchFinalized(uint256 indexed batchNumber, uint256 rewardPerLand);

    /// @notice Emitted when reward is claimed.
    event Claimed(address indexed account, uint256 indexed batchNumber, uint256 indexed tokenId, uint256 amount);

    error CurrentOwnerIsNotKycWallet(address currentOwner);

    /// @notice Constructor
    /// @dev emits a {RewardPerSecondUpdated} event
    /// @param maxRewardTimeWindow The maximum reward time window
    /// @param referee The address of the referee contract
    /// @param landAddress The address of the land contract
    /// @param rewardToken The address of the reward token
    /// @param rewardPerSecond_ The reward per second
    constructor(
        uint256 maxRewardTimeWindow,
        address referee,
        address landAddress,
        address rewardToken,
        uint256 rewardPerSecond_
    ) NodeRewardsBase(referee, landAddress, rewardToken) {
        MAX_REWARD_TIME_WINDOW = maxRewardTimeWindow;

        rewardPerSecond = rewardPerSecond_;
        emit RewardPerSecondUpdated(rewardPerSecond_);

        _setRoleAdmin(REWARDS_CONTROLLER_ROLE, OWNER_ROLE);
        _setRoleAdmin(KYC_CONTROLLER_ROLE, OWNER_ROLE);

        _setRoleAdmin(OWNER_ROLE, OWNER_ROLE);
        _grantRole(OWNER_ROLE, msg.sender);
    }

    /// @notice Sets the max token supply
    /// @dev Reverts with {AccessControlUnauthorizedAccount} if the sender is not the operator.
    /// @dev Emits a {RewardPerSecondUpdated} event.
    /// @param newRewardPerSecond The new new reward per second to be set
    function setRewardPerSecond(uint256 newRewardPerSecond) external onlyRole(REWARDS_CONTROLLER_ROLE) {
        rewardPerSecond = newRewardPerSecond;
        emit RewardPerSecondUpdated(newRewardPerSecond);
    }

    /// @inheritdoc NodeRewardsBase
    function _onAttest(uint256 batchNumber, uint256 tokenId) internal override {
        rewardsRecipients[batchNumber][tokenId] = NODE_KEY.ownerOf(tokenId);
    }

    /// @inheritdoc NodeRewardsBase
    /// @dev Emits a {BatchFinalized} event.
    function _onFinalize(
        uint256 batchNumber,
        uint256 l1NodeConfirmedTimestamp,
        uint256 prevL1NodeConfirmedTimestamp,
        uint256 nrOfSuccessfulAttestations
    ) internal override {
        if (nrOfSuccessfulAttestations > 0) {
            uint256 rewardTimeWindow = Math.min(l1NodeConfirmedTimestamp - prevL1NodeConfirmedTimestamp, MAX_REWARD_TIME_WINDOW);
            uint256 rewardPerLand = (rewardTimeWindow * rewardPerSecond) / nrOfSuccessfulAttestations;
            rewardPerLandOfBatch[batchNumber] = rewardPerLand;
            emit BatchFinalized(batchNumber, rewardPerLand);
        }
    }

    /// @inheritdoc NodeRewardsBase
    /// @dev Reverts if now rewards to claim.
    /// @dev Emits a {Claimed} event.
    function _claimReward(uint256 tokenId, uint256[] calldata batchNumbers) internal override {
        address currentOwner;
        try NODE_KEY.ownerOf(tokenId) returns (address owner) {
            currentOwner = owner;
        } catch {}

        for (uint256 i; i < batchNumbers.length; i++) {
            uint256 batchNumber = batchNumbers[i];
            if (batchNumber == 0) {
                continue;
            }

            address rewardsRecipient = rewardsRecipients[batchNumber][tokenId];
            delete rewardsRecipients[batchNumber][tokenId];
            if (!kycDisabled && !_isKycWallet(rewardsRecipient)) {
                if (currentOwner == rewardsRecipient) {
                    revert CurrentOwnerIsNotKycWallet(currentOwner);
                } else {
                    continue;
                }
            }

            uint256 amount = rewardPerLandOfBatch[batchNumber];
            _payReward(rewardsRecipient, amount);
            emit Claimed(rewardsRecipient, batchNumber, tokenId, amount);
        }
    }

    /// @notice Check if the wallet has been KYCed
    /// @param wallet The wallet to be checked
    function isKycWallet(address wallet) public view returns (bool) {
        return _isKycWallet(wallet);
    }
}
