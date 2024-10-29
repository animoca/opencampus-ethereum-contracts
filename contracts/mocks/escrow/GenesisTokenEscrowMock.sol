// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {GenesisTokenEscrow} from "../../escrow/GenesisTokenEscrow.sol";

contract GenesisTokenEscrowMock is GenesisTokenEscrow {
    bytes public msgData;

    constructor(address genesisToken_, IForwarderRegistry forwarderRegistry) GenesisTokenEscrow(genesisToken_, forwarderRegistry) {}

    function __msgData() external view returns (bytes calldata) {
        return _msgData();
    }
}
