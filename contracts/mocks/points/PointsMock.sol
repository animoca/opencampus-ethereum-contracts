// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {Points} from "../../points/Points.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";

contract PointsMock is Points {
    constructor(IForwarderRegistry forwarderRegistry_) Points(forwarderRegistry_) {}

    function __msgSender() external view returns (address) {
        return _msgSender();
    }

    /// @notice Internal function to access the current msg.data.
    /// @return The current msg.data value.
    function __msgData() external view returns (bytes calldata) {
        return _msgData();
    }
}
