// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.22;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {NodeRewardsBase} from "@gelatonetwork/node-sale-contracts/contracts/NodeRewardsBase.sol";
import {RewardsKYC} from "@gelatonetwork/node-sale-contracts/contracts/RewardsKYC.sol";

contract EDULandRewards is NodeRewardsBase, RewardsKYC {
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant REWARDS_CONTROLLER_ROLE = keccak256("REWARDS_CONTROLLER_ROLE");
    uint256 public immutable MAX_REWARD_TIME_WINDOW;

    uint256 public rewardPerSecond;

    // batchNumber => reward per land
    mapping(uint256 => uint256) public rewardPerLandOfBatch;
    // batchNumber => tokenId => recipient
    mapping(uint256 => mapping(uint256 => address)) public rewardsRecipients;

    event RewardPerSecondUpdated(uint256 rewardPerSecond);

    constructor(
        uint256 maxRewardTimeWindow,
        address referee,
        address landAddress,
        address rewardToken,
        uint256 rewardPerSecond_,
        address owner
    ) NodeRewardsBase(referee, landAddress, rewardToken) {
        MAX_REWARD_TIME_WINDOW = maxRewardTimeWindow;
        rewardPerSecond = rewardPerSecond_;

        _setRoleAdmin(REWARDS_CONTROLLER_ROLE, OWNER_ROLE);
        _setRoleAdmin(KYC_CONTROLLER_ROLE, OWNER_ROLE);

        _setRoleAdmin(OWNER_ROLE, OWNER_ROLE);
        _grantRole(OWNER_ROLE, owner);
    }

    function setRewardPerSecond(uint256 rewardPerSecond_) external onlyRole(REWARDS_CONTROLLER_ROLE) {
        rewardPerSecond = rewardPerSecond_;
        emit RewardPerSecondUpdated(rewardPerSecond_);
    }

    function _onAttest(uint256 batchNumber, uint256 tokenId) internal override {
        rewardsRecipients[batchNumber][tokenId] = NODE_KEY.ownerOf(tokenId);
    }

    function _onFinalize(
        uint256 batchNumber,
        uint256 l1NodeConfirmedTimestamp,
        uint256 prevL1NodeConfirmedTimestamp,
        uint256 nrOfSuccessfulAttestations
    ) internal override {
        if (nrOfSuccessfulAttestations > 0) {
            uint256 rewardTimeWindow = Math.min(l1NodeConfirmedTimestamp - prevL1NodeConfirmedTimestamp, MAX_REWARD_TIME_WINDOW);
            rewardPerLandOfBatch[batchNumber] = (rewardTimeWindow * rewardPerSecond) / nrOfSuccessfulAttestations;
        }
    }

    function _claimReward(uint256 tokenId, uint256[] calldata batchNumbers) internal override {
        for (uint256 i; i < batchNumbers.length; i++) {
            uint256 batchNumber = batchNumbers[i];
            address tokenOwner = rewardsRecipients[batchNumber][tokenId];
            delete rewardsRecipients[batchNumber][tokenId];
            _onlyKycWallet(tokenOwner);
            _payReward(tokenOwner, rewardPerLandOfBatch[batchNumber]);
        }
    }
}
