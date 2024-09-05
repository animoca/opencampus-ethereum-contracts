// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IERC20} from "@animoca/ethereum-contracts/contracts/token/ERC20/interfaces/IERC20.sol";
import {IERC721} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721.sol";
import {IOCP} from "../OCP/interfaces/IOCP.sol";
import {ContractOwnershipStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/ContractOwnershipStorage.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {TokenRecovery} from "@animoca/ethereum-contracts/contracts/security/TokenRecovery.sol";
import {InconsistentArrayLengths} from "@animoca/ethereum-contracts/contracts/CommonErrors.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {ForwarderRegistryContext}  from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";

contract EDUNodeKeyRental is TokenRecovery, ForwarderRegistryContext {
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;

    struct RentalInfo {
        uint256 expiryDate;
        uint256 gracePeriodEndDate;
        uint256 feePerSecond;
    }

    bytes32 public constant RENTAL_CONSUME_CODE = keccak256("NODE_KEY_RENTAL");

    IOCP public OCP;
    IERC721 public immutable INVENTORY;
    IERC20 public immutable PAYMENT_TOKEN;
    uint256 public feePerSecond;
    uint256 public gracePeriod;
    mapping(uint256 => RentalInfo) public rentals;

    event Rental(address indexed renter, uint256[] tokenIds, RentalInfo[] rentals, uint256[] fees);

    error InvalidTokenIdsParam();
    error ZeroRentalDuration();
    error NotRentable(uint256 tokenId);
    error NotRented(uint256 tokenId);
    error NotCollectable(uint256 tokenId);

    constructor(
        address inventoryAddress,
        address ocpAddress,
        uint256 feePerSecond_,
        uint256 gracePeriod_,
        IForwarderRegistry forwarderRegistry
    ) ContractOwnership(msg.sender) ForwarderRegistryContext(forwarderRegistry) {
        INVENTORY = IERC721(inventoryAddress);
        OCP = IOCP(ocpAddress);
        feePerSecond = feePerSecond_;
        gracePeriod = gracePeriod_;
    }

    function estimateFee(address account, uint256 tokenId, uint256 duration) public view returns (uint256 fee) {
        uint256 currentTime = block.timestamp;
        address currentNodeKeyOwner = INVENTORY.ownerOf(tokenId);
        RentalInfo storage rental = rentals[tokenId];
        return _estimateFeePerSecond(account, tokenId, currentTime, currentNodeKeyOwner, rental) * duration;
    }

    function rent(address account, uint256 tokenId, uint256 duration) public {
        (RentalInfo memory rentalInfo, uint256 fee) = _processRent(account, tokenId, duration);

        OCP.consume(_msgSender(), fee, RENTAL_CONSUME_CODE);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = tokenId;

        RentalInfo[] memory rentalInfos = new RentalInfo[](1);
        rentalInfos[0] = rentalInfo;

        uint256[] memory fees = new uint256[](1);
        fees[0] = fee;

        emit Rental(account, tokenIds, rentalInfos, fees);
    }

    function batchRent(address account, uint256[] calldata tokenIds, uint256[] calldata durations) public {
        if (tokenIds.length == 0) {
            revert InvalidTokenIdsParam();
        }

        if (tokenIds.length != durations.length) {
            revert InconsistentArrayLengths();
        }

        uint256 totalFee = 0;
        RentalInfo[] memory rentalInfos = new RentalInfo[](tokenIds.length);
        uint256[] memory fees = new uint256[](tokenIds.length);

        for (uint256 i = 0; i < tokenIds.length; i++) {
            (RentalInfo memory rentalInfo, uint256 fee) = _processRent(account, tokenIds[i], durations[i]);
            rentalInfos[i] = rentalInfo;
            fees[i] = fee;
            totalFee += fee;
        }

        OCP.consume(_msgSender(), totalFee, RENTAL_CONSUME_CODE);

        emit Rental(account, tokenIds, rentalInfos, fees);
    }

    function renterOf(uint256 tokenId) public view returns (address) {
        if (block.timestamp < rentals[tokenId].expiryDate) {
            return INVENTORY.ownerOf(tokenId);
        } else {
            revert NotRented(tokenId);
        }
    }

    function setFeePerSecond(uint256 newAmount) external {
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());
        feePerSecond = newAmount;
    }

    function setGracePeriod(uint256 newGracePeriod) external {
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());
        gracePeriod = newGracePeriod;
    }

    function collectIdledTokens(uint256[] calldata tokenIds) external {
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            address currentOwner = INVENTORY.ownerOf(tokenId);
            if (currentOwner == address(this)) {
                revert NotRented(tokenId);
            }

            if (block.timestamp < rentals[tokenId].gracePeriodEndDate) {
                revert NotCollectable(tokenId);
            }

            INVENTORY.transferFrom(currentOwner, address(this), tokenId);
        }
    }

    function _estimateFeePerSecond(
        address account,
        uint256 tokenId,
        uint256 currentTime,
        address currentNodeKeyOwner,
        RentalInfo memory currentRentalInfo
    ) internal view returns (uint256 fee) {
        uint256 decidedFeePerSecond;
        uint256 currentGracePeriodEndDate = currentRentalInfo.gracePeriodEndDate;
        if (currentGracePeriodEndDate != 0 && currentTime < currentGracePeriodEndDate) {
            if (currentNodeKeyOwner != account) {
                // Not expired, and not in grace period. The node key rental can only be extended by the current renter.
                revert NotRentable(tokenId);
            } else {
                // Extend the rental, use the previous fee per second.
                decidedFeePerSecond = currentRentalInfo.feePerSecond;
            }
        } else {
            // Expired and grace period passed. Should consider this is a new rental that use the latest price.
            decidedFeePerSecond = feePerSecond;
        }

        return decidedFeePerSecond;
    }

    function _processRent(address account, uint256 tokenId, uint256 duration) internal returns (RentalInfo memory rentalInfo, uint256 fee) {
        if (duration == 0) {
            revert ZeroRentalDuration();
        }

        uint256 currentTime = block.timestamp;
        RentalInfo storage rental = rentals[tokenId];
        address currentNodeKeyOwner = INVENTORY.ownerOf(tokenId);
        uint256 decidedFeePerSecond = _estimateFeePerSecond(account, tokenId, currentTime, currentNodeKeyOwner, rental);
        fee = decidedFeePerSecond * duration;

        uint256 currentExpiry = rental.expiryDate;

        uint256 expiryDate = currentTime > currentExpiry ? currentTime + duration : currentExpiry + duration;
        uint256 gracePeriodEndDate = expiryDate + gracePeriod;

        rental.expiryDate = expiryDate;
        rental.gracePeriodEndDate = gracePeriodEndDate;
        rental.feePerSecond = decidedFeePerSecond;

        INVENTORY.safeTransferFrom(currentNodeKeyOwner, account, tokenId);

        rentalInfo = rental;

        return (rentalInfo, fee);
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
