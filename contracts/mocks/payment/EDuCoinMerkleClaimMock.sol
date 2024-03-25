// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {IERC20} from "@animoca/ethereum-contracts/contracts/token/ERC20/interfaces/IERC20.sol";
import {EDuCoinMerkleClaim} from "../../payment/EDuCoinMerkleClaim.sol";

contract EDuCoinMerkleClaimMock is EDuCoinMerkleClaim {
    bytes public msgData;

    constructor(
        IERC20 erc20_,
        address messageSigner_,
        IForwarderRegistry forwarderRegistry_
    ) EDuCoinMerkleClaim(erc20_, messageSigner_, forwarderRegistry_) {}

    function __msgData() external view returns (bytes calldata) {
        return _msgData();
    }
}
