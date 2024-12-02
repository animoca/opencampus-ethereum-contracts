// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.22;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {NodeRewardsBase} from "gelatonetwork-node-sale-contracts/contracts/NodeRewardsBase.sol";
import {RewardsKYC} from "gelatonetwork-node-sale-contracts/contracts/RewardsKYC.sol";

contract EDUNodeRewards is NodeRewardsBase, RewardsKYC {
    bytes32 public constant ADMIN_REWARDS_CONTROLLER_ROLE = keccak256("ADMIN_REWARDS_CONTROLLER_ROLE");
    bytes32 public constant REWARDS_CONTROLLER_ROLE = keccak256("REWARDS_CONTROLLER_ROLE");
    uint256 public immutable MAX_REWARD_TIME_WINDOW;

    uint256 public rewardPerSecond;

    // batchNumber => reward per node key
    mapping(uint256 => uint256) public rewardPerNodeKeyOfBatch;
    // batchNumber => nodeKeyId => nodeKeyOwner
    mapping(uint256 => mapping(uint256 => address)) public rewardsRecipients;

    event LogSetRewardPerSecond(uint256 rewardPerSecond);

    constructor(uint256 maxRewardTimeWindow, address referee, address nodeKey, address rewardToken) NodeRewardsBase(referee, nodeKey, rewardToken) {
        _disableInitializers();
        MAX_REWARD_TIME_WINDOW = maxRewardTimeWindow;
    }

    function initialize(uint256 rewardPerSecond_, address rewardsController, address adminKycController) external initializer {
        rewardPerSecond = rewardPerSecond_;

        _setRoleAdmin(REWARDS_CONTROLLER_ROLE, ADMIN_REWARDS_CONTROLLER_ROLE);
        _grantRole(ADMIN_REWARDS_CONTROLLER_ROLE, rewardsController);

        __RewardsKYC_init(adminKycController);
    }

    function setRewardPerSecond(uint256 rewardPerSecond_) external onlyRole(REWARDS_CONTROLLER_ROLE) {
        rewardPerSecond = rewardPerSecond_;
        emit LogSetRewardPerSecond(rewardPerSecond_);
    }

    function _onAttest(uint256 batchNumber, uint256 nodeKeyId) internal override {
        rewardsRecipients[batchNumber][nodeKeyId] = NODE_KEY.ownerOf(nodeKeyId);
    }

    function _onFinalize(
        uint256 batchNumber,
        uint256 l1NodeConfirmedTimestamp,
        uint256 prevL1NodeConfirmedTimestamp,
        uint256 nrOfSuccessfulAttestations
    ) internal override {
        if (nrOfSuccessfulAttestations > 0) {
            uint256 rewardTimeWindow = Math.min(l1NodeConfirmedTimestamp - prevL1NodeConfirmedTimestamp, MAX_REWARD_TIME_WINDOW);
            rewardPerNodeKeyOfBatch[batchNumber] = (rewardTimeWindow * rewardPerSecond) / nrOfSuccessfulAttestations;
        }
    }

    function _claimReward(uint256 nodeKeyId, uint256[] calldata batchNumber) internal override {
        for (uint256 i; i < batchNumbers.length; i++) {
            uint256 batchNumber = batchNumbers[i];
            if (batchNumber != 0) {
                address nodeKeyOwner = rewardsRecipients[batchNumber][nodeKeyId];
                delete rewardsRecipients[batchNumber][nodeKeyId];
                _onlyKycWallet(nodeKeyOwner);
                _payReward(nodeKeyOwner, rewardPerNodeKeyOfBatch[batchNumber]);
            }
        }
    }
}
