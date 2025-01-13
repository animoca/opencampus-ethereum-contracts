// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {MockReferee} from "@gelatonetwork/node-sale-rewards/contracts/MockReferee.sol";

contract RefereeMock is MockReferee {
    constructor(address nodeKey) MockReferee(nodeKey) {}

    function claimRewardAllNonSuccessfulAttestations(uint256 _nodeKeyId, uint256 _batchesCount) external {
        uint256[] memory claimableBatchNumbers = new uint256[](_batchesCount);
        nodeRewards.claimReward(_nodeKeyId, claimableBatchNumbers);
    }
}
