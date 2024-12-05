// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {ITokenMetadataResolver} from "@animoca/ethereum-contracts/contracts/token/metadata/interfaces/ITokenMetadataResolver.sol";
import {EDULand} from "../../land/EDULand.sol";

contract EDULandMock is EDULand {
    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        ITokenMetadataResolver metadataResolver,
        IForwarderRegistry forwarderRegistry
    ) EDULand(tokenName, tokenSymbol, metadataResolver, forwarderRegistry) {}

    function __msgData() external view returns (bytes calldata) {
        return _msgData();
    }
}
