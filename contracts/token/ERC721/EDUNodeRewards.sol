// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.22;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {NodeRewardsBase} from "gelatonetwork-node-sale-contracts/contracts/NodeRewardsBase.sol";
import {RewardsKYC} from "gelatonetwork-node-sale-contracts/contracts/RewardsKYC.sol";

contract EDUNodeRewards is NodeRewardsBase, RewardsKYC {
    bytes32 public constant ADMIN_REWARDS_CONTROLLER_ROLE =
        keccak256("ADMIN_REWARDS_CONTROLLER_ROLE");
    bytes32 public constant REWARDS_CONTROLLER_ROLE =
        keccak256("REWARDS_CONTROLLER_ROLE");
    uint256 public immutable MAX_REWARD_TIME_WINDOW;

    uint256 public rewardPerSecond;

    // batchNumber => reward per node key
    mapping(uint256 => uint256) public rewardPerNodeKeyOfBatch;
    // batchNumber => nodeKeyId => nodeKeyOwner
    mapping(uint256 => mapping(uint256 => address)) public rewardsRecipients;

    event LogSetRewardPerSecond(uint256 rewardPerSecond);

    constructor(
        uint256 _maxRewardTimeWindow,
        address _referee,
        address _nodeKey,
        address _rewardToken
    ) NodeRewardsBase(_referee, _nodeKey, _rewardToken) {
        _disableInitializers();
        MAX_REWARD_TIME_WINDOW = _maxRewardTimeWindow;
    }

    function initialize(
        uint256 _rewardPerSecond,
        address _rewardsController,
        address _adminKycController
    ) external initializer {
        rewardPerSecond = _rewardPerSecond;

        _setRoleAdmin(REWARDS_CONTROLLER_ROLE, ADMIN_REWARDS_CONTROLLER_ROLE);
        _grantRole(ADMIN_REWARDS_CONTROLLER_ROLE, _rewardsController);

        __RewardsKYC_init(_adminKycController);
    }

    function setRewardPerSecond(
        uint256 _rewardPerSecond
    ) external onlyRole(REWARDS_CONTROLLER_ROLE) {
        rewardPerSecond = _rewardPerSecond;

        emit LogSetRewardPerSecond(_rewardPerSecond);
    }

    function _onAttest(uint256 _batchNumber, uint256 _nodeKeyId) internal override {
        rewardsRecipients[_batchNumber][_nodeKeyId] = NODE_KEY.ownerOf(_nodeKeyId);
    }

    function _onFinalize(
        uint256 _batchNumber,
        uint256 _l1NodeConfirmedTimestamp,
        uint256 _prevL1NodeConfirmedTimestamp,
        uint256 _nrOfSuccessfulAttestations
    ) internal override {
        if (_nrOfSuccessfulAttestations > 0) {
            uint256 rewardTimeWindow = Math.min(
                _l1NodeConfirmedTimestamp - _prevL1NodeConfirmedTimestamp,
                MAX_REWARD_TIME_WINDOW
            );

            rewardPerNodeKeyOfBatch[_batchNumber] =
                (rewardTimeWindow * rewardPerSecond) /
                _nrOfSuccessfulAttestations;
        }
    }

    function _claimReward(
        uint256 _nodeKeyId,
        uint256[] calldata _batchNumbers
    ) internal override {
        for (uint256 i; i < _batchNumbers.length; i++) {
            uint256 batchNumber = _batchNumbers[i];
            if (batchNumber != 0) {
                address nodeKeyOwner = rewardsRecipients[batchNumber][_nodeKeyId];
                delete rewardsRecipients[batchNumber][_nodeKeyId];
                _onlyKycWallet(nodeKeyOwner);
                _payReward(nodeKeyOwner, rewardPerNodeKeyOfBatch[batchNumber]);
            }
        }
    }
}
