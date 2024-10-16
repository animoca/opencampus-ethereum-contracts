// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {PublisherNFTEscrow} from "../../escrow/PublisherNFTEscrow.sol";

contract PublisherNFTEscrowMock is PublisherNFTEscrow {
    bytes public msgData;

    constructor(address[] memory _supportedTokens, IForwarderRegistry forwarderRegistry) PublisherNFTEscrow(_supportedTokens, forwarderRegistry) {}

    function __msgData() external view returns (bytes calldata) {
        return _msgData();
    }
}
