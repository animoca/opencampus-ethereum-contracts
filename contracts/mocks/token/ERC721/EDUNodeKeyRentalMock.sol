// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {EDUNodeKeyRental} from "../../../token/ERC721/EDUNodeKeyRental.sol";

contract EDUNodeKeyRentalMock is EDUNodeKeyRental {
    bytes public msgData;

    constructor(
        address inventoryAddress,
        address ocpAddress,
        uint256 monthlyMaintenceFee_,
        IForwarderRegistry forwarderRegistry
    ) EDUNodeKeyRental(inventoryAddress, ocpAddress, monthlyMaintenceFee_, forwarderRegistry) {
    }

    function __msgData() external view returns (bytes calldata) {
        return _msgData();
    }
}
