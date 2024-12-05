// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {ITokenMetadataResolver} from "@animoca/ethereum-contracts/contracts/token/metadata/interfaces/ITokenMetadataResolver.sol";
<<<<<<< HEAD:contracts/mocks/token/ERC721/EDULandMock.sol
import {EDULand} from "../../../land/EDULand.sol";
=======
import {EDULand} from "../../land/EDULand.sol";
>>>>>>> 4a5593bf7741627c6cef946c7959691cb4f43d5e:contracts/mocks/land/EDULandMock.sol

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
