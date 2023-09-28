// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {IERC721Mintable} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721Mintable.sol";
import {ILayerZeroEndpoint} from "@layerzerolabs/solidity-examples/contracts/interfaces/ILayerZeroEndpoint.sol";
import {ILayerZeroReceiver} from "@layerzerolabs/solidity-examples/contracts/interfaces/ILayerZeroReceiver.sol";

/// @title PublisherNFTMinter
/// @notice todo
contract PublisherNFTMinter is ILayerZeroReceiver {
    IERC721Mintable public immutable PUBLISHER_NFT;
    ILayerZeroEndpoint public immutable LZ_ENDPOINT;
    uint16 public immutable LZ_SRC_CHAINID;
    address public immutable LZ_SRC_ADDRESS;
    uint256 public immutable MINT_SUPPLY_LIMIT;

    uint256 public mintCount;

    error UnauthorizedSender(address sender);
    error IncorrectSrcChainId(uint16 srcChainId);
    error IncorrectSrcAddress(address srcAddress);
    error InsufficientMintSupply();

    constructor(IERC721Mintable publisherNFT, ILayerZeroEndpoint lzEndpoint, uint16 lzSrcChainId, address lzSrcAddress, uint256 mintSupplyLimit) {
        PUBLISHER_NFT = publisherNFT;
        LZ_ENDPOINT = lzEndpoint;
        LZ_SRC_CHAINID = lzSrcChainId;
        LZ_SRC_ADDRESS = lzSrcAddress;
        MINT_SUPPLY_LIMIT = mintSupplyLimit;
    }

    /// @notice LayerZero endpoint will invoke this function to deliver the message on the destination
    /// @param srcChainId - the source endpoint identifier
    /// @param srcAddress - the source sending contract address from the source chain
    // / @param nonce - the ordered message nonce
    /// @param payload - the signed payload is the UA bytes has encoded to be sent
    function lzReceive(uint16 srcChainId, bytes memory srcAddress, uint64, bytes calldata payload) external {
        if (msg.sender != address(LZ_ENDPOINT)) revert UnauthorizedSender(msg.sender);
        if (srcChainId != LZ_SRC_CHAINID) revert IncorrectSrcChainId(srcChainId);
        address fromAddress;
        assembly {
            fromAddress := mload(add(srcAddress, 20))
        }
        if (fromAddress != LZ_SRC_ADDRESS) revert IncorrectSrcAddress(fromAddress);
        (address tokenOwner, uint256 nbTokens) = abi.decode(payload, (address, uint256));

        uint256 currentMintCount = mintCount;
        if (currentMintCount + nbTokens > MINT_SUPPLY_LIMIT) revert InsufficientMintSupply();
        uint256[] memory tokenIds = new uint256[](nbTokens);
        for (uint256 i; i != nbTokens; ++i) {
            tokenIds[i] = currentMintCount;
            ++currentMintCount;
        }
        mintCount = currentMintCount;
        PUBLISHER_NFT.batchMint(tokenOwner, tokenIds);
    }
}
