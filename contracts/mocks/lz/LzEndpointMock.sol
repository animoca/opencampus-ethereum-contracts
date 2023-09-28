// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {ILayerZeroReceiver} from "@layerzerolabs/solidity-examples/contracts/interfaces/ILayerZeroReceiver.sol";

/// @title LzEndpointMock
contract LzEndpointMock {
    uint16 public immutable LZ_SRC_CHAINID;

    bytes public destination;
    bytes public payload;

    constructor(uint16 lzSrcChainId) {
        LZ_SRC_CHAINID = lzSrcChainId;
    }

    // @notice send a LayerZero message to the specified address at a LayerZero endpoint.
    // @param _dstChainId - the destination chain identifier
    // @param _destination - the address on destination chain (in bytes). address length/format may vary by chains
    // @param _payload - a custom bytes payload to send to the destination contract
    // @param _refundAddress - if the source transaction is cheaper than the amount of value passed, refund the additional amount to this address
    // @param _zroPaymentAddress - the address of the ZRO token holder who would pay for the transaction
    // @param _adapterParams - parameters for custom functionality. e.g. receive airdropped native gas from the relayer on destination
    function send(uint16, bytes memory destination_, bytes calldata payload_, address payable, address, bytes calldata) external payable {
        destination = destination_;
        payload = payload_;
    }

    function process() external {
        bytes memory dest = destination;
        address fromAddress;
        assembly {
            fromAddress := mload(add(dest, 20))
        }
        ILayerZeroReceiver(fromAddress).lzReceive(LZ_SRC_CHAINID, destination, 0, payload);
    }

    function estimateFees(uint16, address, bytes calldata, bool, bytes calldata) external pure returns (uint256, uint256) {
        return (100, 100);
    }
}
