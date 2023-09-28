// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {IERC1155} from "@animoca/ethereum-contracts/contracts/token/ERC1155/interfaces/IERC1155.sol";
import {ILayerZeroEndpoint} from "@layerzerolabs/solidity-examples/contracts/interfaces/ILayerZeroEndpoint.sol";
import {ContractOwnershipStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/ContractOwnershipStorage.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {EDUCreditsManager} from "./../payment/EDUCreditsManager.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {ForwarderRegistryContext} from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";

/// @title PublisherNFTSale
/// @notice todo
contract PublisherNFTSale is ContractOwnership, ForwarderRegistryContext {
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;

    IERC1155 public immutable GENESIS_TOKEN;
    EDUCreditsManager public immutable EDU_CREDITS_MANAGER;

    ILayerZeroEndpoint public immutable LZ_ENDPOINT;
    uint16 public immutable LZ_DST_CHAINID;

    uint256 public immutable MINT_PRICE;
    uint256 public immutable MINT_SUPPLY_LIMIT;

    uint256 public immutable PHASE1_START_TIMESTAMP;
    uint256 public immutable PHASE2_START_TIMESTAMP;
    uint256 public immutable PHASE3_START_TIMESTAMP;
    uint256 public immutable SALE_END_TIMESTAMP;

    uint256 public immutable DISCOUNT_THRESHOLD_1;
    uint256 public immutable DISCOUNT_THRESHOLD_2;
    uint256 public immutable DISCOUNT_THRESHOLD_3;

    uint256 public immutable DISCOUNT_PERCENTAGE_1;
    uint256 public immutable DISCOUNT_PERCENTAGE_2;
    uint256 public immutable DISCOUNT_PERCENTAGE_3;

    address public lzDstAddress;
    uint256 public mintCount;

    event MintInitiated(address sender, uint256 nbTokens, uint256 discountThreshold);

    error InvalidTimestamps();
    error InvalidDiscountThresholds();
    error InvalidDiscountPercentages();
    error SaleNotStarted();
    error NotADiamondHand();
    error NotADiamondHandNorAGenesisNFTOwner();
    error SaleEnded();
    error InsufficientMintSupply();

    constructor(
        IERC1155 genesisToken,
        EDUCreditsManager eduCreditsManager,
        ILayerZeroEndpoint lzEndpoint,
        uint16 lzDstChainId,
        uint256 mintPrice,
        uint256 mintSupplyLimit,
        uint256[] memory timestamps,
        uint256[] memory discountThresholds,
        uint256[] memory discountPercentages,
        IForwarderRegistry forwarderRegistry
    ) ContractOwnership(msg.sender) ForwarderRegistryContext(forwarderRegistry) {
        GENESIS_TOKEN = genesisToken;
        EDU_CREDITS_MANAGER = eduCreditsManager;
        LZ_ENDPOINT = lzEndpoint;
        LZ_DST_CHAINID = lzDstChainId;
        MINT_PRICE = mintPrice;
        MINT_SUPPLY_LIMIT = mintSupplyLimit;
        if (timestamps[1] <= timestamps[0] || timestamps[2] <= timestamps[1] || timestamps[3] <= timestamps[2]) revert InvalidTimestamps();
        PHASE1_START_TIMESTAMP = timestamps[0];
        PHASE2_START_TIMESTAMP = timestamps[1];
        PHASE3_START_TIMESTAMP = timestamps[2];
        SALE_END_TIMESTAMP = timestamps[3];
        if (discountThresholds[1] <= discountThresholds[0] || discountThresholds[2] <= discountThresholds[1]) revert InvalidDiscountThresholds();
        DISCOUNT_THRESHOLD_1 = discountThresholds[0];
        DISCOUNT_THRESHOLD_2 = discountThresholds[1];
        DISCOUNT_THRESHOLD_3 = discountThresholds[2];
        if (discountPercentages[1] <= discountPercentages[0] || discountPercentages[2] <= discountPercentages[1]) revert InvalidDiscountPercentages();
        DISCOUNT_PERCENTAGE_1 = discountPercentages[0];
        DISCOUNT_PERCENTAGE_2 = discountPercentages[1];
        DISCOUNT_PERCENTAGE_3 = discountPercentages[2];
    }

    function setLzDstAddress(address lzDstAddress_) external {
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());
        lzDstAddress = lzDstAddress_;
        // todo refuse to set again if already set
    }

    function withdraw(address to) external {
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());
        uint256 balance = address(this).balance;
        if (balance > 0) {
            payable(to).transfer(balance);
        }
    }

    function mint(uint256 nbTokens) external {
        address sender = _msgSender();
        if (block.timestamp > SALE_END_TIMESTAMP) {
            revert SaleEnded();
        } else if (block.timestamp >= PHASE3_START_TIMESTAMP) {
            // no restrictions, open sale
        } else if (block.timestamp >= PHASE2_START_TIMESTAMP) {
            if (!EDU_CREDITS_MANAGER.diamondHand(sender) && GENESIS_TOKEN.balanceOf(sender, 0) == 0 && GENESIS_TOKEN.balanceOf(sender, 1) == 0)
                revert NotADiamondHandNorAGenesisNFTOwner();
        } else if (block.timestamp >= PHASE1_START_TIMESTAMP) {
            if (!EDU_CREDITS_MANAGER.diamondHand(sender)) revert NotADiamondHand();
        } else {
            revert SaleNotStarted();
        }
        uint256 currentMintCount = mintCount;
        uint256 newMintCount = currentMintCount + nbTokens;
        if (newMintCount > MINT_SUPPLY_LIMIT) revert InsufficientMintSupply();
        mintCount = newMintCount;
        (uint256 price, uint256 discountThreshold) = getMintPrice();
        EDU_CREDITS_MANAGER.spend(sender, price * nbTokens);

        bytes memory payload = abi.encode(sender, nbTokens);
        (uint256 fees, ) = LZ_ENDPOINT.estimateFees(LZ_DST_CHAINID, lzDstAddress, payload, false, "");
        // solhint-disable-next-line check-send-result
        LZ_ENDPOINT.send{value: fees}(LZ_DST_CHAINID, abi.encodePacked(lzDstAddress, address(this)), payload, payable(address(this)), address(0), "");
        emit MintInitiated(sender, nbTokens, discountThreshold);
    }

    function getMintPrice() public view returns (uint256 price, uint256 discountThreshold) {
        price = MINT_PRICE;
        uint256 currentCreditsInPool = EDU_CREDITS_MANAGER.totalCredits();
        if (currentCreditsInPool >= DISCOUNT_THRESHOLD_3) {
            price = (price * (100 - DISCOUNT_PERCENTAGE_3)) / 100;
            discountThreshold = 3;
        } else if (currentCreditsInPool >= DISCOUNT_THRESHOLD_2) {
            price = (price * (100 - DISCOUNT_PERCENTAGE_2)) / 100;
            discountThreshold = 2;
        } else if (currentCreditsInPool >= DISCOUNT_THRESHOLD_1) {
            price = (price * (100 - DISCOUNT_PERCENTAGE_1)) / 100;
            discountThreshold = 1;
        }
    }

    function currentSalePhase() public view returns (uint256) {
        if (block.timestamp > SALE_END_TIMESTAMP) {
            return 4;
        } else if (block.timestamp >= PHASE3_START_TIMESTAMP) {
            return 3;
        } else if (block.timestamp >= PHASE2_START_TIMESTAMP) {
            return 2;
        } else if (block.timestamp >= PHASE1_START_TIMESTAMP) {
            return 1;
        } else {
            return 0;
        }
    }

    function canMint(address account) public view returns (bool) {
        if (block.timestamp > SALE_END_TIMESTAMP) {
            return false;
        } else if (block.timestamp >= PHASE3_START_TIMESTAMP) {
            return true;
        } else if (block.timestamp >= PHASE2_START_TIMESTAMP) {
            return EDU_CREDITS_MANAGER.diamondHand(account) || GENESIS_TOKEN.balanceOf(account, 0) != 0 || GENESIS_TOKEN.balanceOf(account, 1) != 0;
        } else if (block.timestamp >= PHASE1_START_TIMESTAMP) {
            return EDU_CREDITS_MANAGER.diamondHand(account);
        } else {
            return false;
        }
    }

    /// @inheritdoc ForwarderRegistryContextBase
    function _msgSender() internal view virtual override(Context, ForwarderRegistryContextBase) returns (address) {
        return ForwarderRegistryContextBase._msgSender();
    }

    /// @inheritdoc ForwarderRegistryContextBase
    function _msgData() internal view virtual override(Context, ForwarderRegistryContextBase) returns (bytes calldata) {
        return ForwarderRegistryContextBase._msgData();
    }
}
