// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {MockReferee} from "@gelatonetwork/node-sale-contracts/contracts/MockReferee.sol";

contract RefereeMock is MockReferee {
    constructor(address nodeKey) MockReferee(nodeKey) {}
}
