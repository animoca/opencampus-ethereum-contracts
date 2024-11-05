// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IERC20} from "@animoca/ethereum-contracts/contracts/token/ERC20/interfaces/IERC20.sol";
import {IERC721} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721.sol";
import {Points} from "@animoca/anichess-ethereum-contracts-2.2.3/contracts/points/Points.sol";
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
        uint256 beginDate;
        uint256 endDate;
    }

    bytes32 public constant RENTAL_CONSUME_CODE = keccak256("NODE_KEY_RENTAL");

    Points public immutable POINTS;
    IERC721 public immutable INVENTORY;
    uint256 public immutable INITIAL_TIME;

    uint256 public monthlyMaintenanceFee;

    mapping(uint256 => RentalInfo) public rentals;

    uint256 public totalEffectiveRentalTime;

    event Rental(address indexed renter, uint256 tokenId, RentalInfo rental, uint256 fee);
    event BatchRental(address indexed renter, uint256[] tokenIds, RentalInfo[] rentals, uint256[] fees);

    error InvalidTokenIdsParam();
    error ZeroRentalDuration();
    error NotRentable(uint256 tokenId);
    error NotRented(uint256 tokenId);
    error NotCollectable(uint256 tokenId);

    constructor(
        address inventoryAddress,
        address ocpAddress,
        uint256 monthlyMaintenanceFee_,
        IForwarderRegistry forwarderRegistry
    ) ContractOwnership(msg.sender) ForwarderRegistryContext(forwarderRegistry) {
        INVENTORY = IERC721(inventoryAddress);
        POINTS = Points(ocpAddress);
        monthlyMaintenanceFee = monthlyMaintenanceFee_;
        INITIAL_TIME = block.timestamp;
    }

    function estimateFee(uint256 duration, uint256[] calldata expiredNodeKeyIds) public view returns (uint256 fee) {
        uint256 finishedRentalTime = 0;
        for (uint256 i = 0; i < expiredNodeKeyIds.length; i++) {
            uint256 tokenId = expiredNodeKeyIds[i];
            address currentOwner = INVENTORY.ownerOf(tokenId);
            if (currentOwner == address(this)) {
                revert NotRented(tokenId);
            }

            RentalInfo storage rental = rentals[tokenId];
            if (block.timestamp < rental.endDate) {
                revert NotCollectable(tokenId);
            }

            finishedRentalTime += rental.endDate - rental.beginDate;
        }

        return _estimateNodeKeyPrice(totalEffectiveRentalTime - finishedRentalTime) + monthlyMaintenanceFee * duration;
    }

    function rent(address account, uint256 tokenId, uint256 duration, uint256[] calldata expiredNodeKeyIds) public {
        if (duration == 0) {
            revert ZeroRentalDuration();
        }

        uint256 currentTime = block.timestamp;
        uint256 finishedRentalTime = _collectExpiredTokens(expiredNodeKeyIds, currentTime);

        (RentalInfo memory rental, uint256 maintenanceFee, uint256 elaspedTime) = processRent(account, tokenId, duration, block.timestamp);
        uint256 preEffectiveRentalTime = totalEffectiveRentalTime - finishedRentalTime - elaspedTime;
        uint256 nodeKeyPrice = _estimateNodeKeyPrice(preEffectiveRentalTime);
        totalEffectiveRentalTime = preEffectiveRentalTime + duration;

        uint256 fee = nodeKeyPrice + maintenanceFee;
        POINTS.consume(_msgSender(), fee, RENTAL_CONSUME_CODE);
        emit Rental(account, tokenId, rental, fee);
    }

    function batchRent(address account, uint256[] calldata tokenIds, uint256[] calldata durations, uint256[] calldata expiredNodeKeyIds) public {
        if (tokenIds.length != durations.length) {
            revert InconsistentArrayLengths();
        }

        address account_ = account;
        uint256[] memory tokenIds_ = tokenIds;
        uint256[] memory durations_ = durations;
        uint256[] memory expiredNodeKeyIds_ = expiredNodeKeyIds;

        uint256 currentTime = block.timestamp;
        uint256 finishedRentalTime = _collectExpiredTokens(expiredNodeKeyIds_, currentTime);

        RentalInfo[] memory rentalInfos;
        uint256[] memory fees;
        uint256 totalFee;
        for (uint256 i = 0; i < tokenIds_.length; i++) {
            uint256 tokenId = tokenIds_[i];
            (RentalInfo memory rental, uint256 maintenanceFee, uint256 elaspedTime) = processRent(account_, tokenId, durations_[i], currentTime);
            finishedRentalTime += elaspedTime;
            rentalInfos[i] = rental;
            fees[i] = maintenanceFee;
            totalFee += maintenanceFee;
        }

        uint256 preEffectiveRentalTime = totalEffectiveRentalTime - finishedRentalTime;
        uint256 nodeKeyPrice = _estimateNodeKeyPrice(preEffectiveRentalTime);
        totalEffectiveRentalTime = preEffectiveRentalTime;
        totalFee += nodeKeyPrice * tokenIds_.length;
        for (uint256 i = 0; i < fees.length; i++) {
            fees[i] += nodeKeyPrice;
        }

        POINTS.consume(_msgSender(), totalFee, RENTAL_CONSUME_CODE);
        emit BatchRental(account_, tokenIds_, rentalInfos, fees);
    }

    function processRent(address account, uint256 tokenId, uint256 duration, uint256 currentTime) internal returns (RentalInfo memory, uint256, uint256 elaspedRentalTime) {
        RentalInfo storage rental = rentals[tokenId];
        address currentNodeKeyOwner = INVENTORY.ownerOf(tokenId);

        if (address(this) != currentNodeKeyOwner) {
            if (currentTime >= rental.endDate) {
                elaspedRentalTime = rental.endDate - rental.beginDate;
            } else if (account == currentNodeKeyOwner) {
                elaspedRentalTime = currentTime - rental.beginDate;
            } else {
                revert NotRentable(tokenId);
            }
        }

        uint256 currentExpiry = rental.endDate;
        if (currentTime >= currentExpiry) {
            // New period
            rental.beginDate = currentTime;
            rental.endDate = currentTime + duration;
            INVENTORY.safeTransferFrom(currentNodeKeyOwner, account, tokenId);
        } else {
            // Extend the period
            rental.beginDate = currentExpiry;
            rental.endDate = currentExpiry + duration;
        }

        return (rental, monthlyMaintenanceFee * duration, elaspedRentalTime);
    }

    function renterOf(uint256 tokenId) public view returns (address) {
        if (block.timestamp < rentals[tokenId].endDate) {
            return INVENTORY.ownerOf(tokenId);
        } else {
            revert NotRented(tokenId);
        }
    }

    function setMonthlyMaintenanceFee(uint256 monthlyMaintenanceFee_) external {
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());
        monthlyMaintenanceFee = monthlyMaintenanceFee_;
    }

    function collectExpiredTokens(uint256[] calldata tokenIds) public {
        uint256 finishedRentalTime = _collectExpiredTokens(tokenIds, block.timestamp);
        totalEffectiveRentalTime -= finishedRentalTime;
    }

    function _collectExpiredTokens(uint256[] memory tokenIds, uint256 blockTime) internal returns (uint256 finishedRentalTime){
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            address currentOwner = INVENTORY.ownerOf(tokenId);
            if (currentOwner == address(this)) {
                revert NotRented(tokenId);
            }

            RentalInfo storage rental = rentals[tokenId];
            if (blockTime < rental.endDate) {
                revert NotCollectable(tokenId);
            }

            INVENTORY.transferFrom(currentOwner, address(this), tokenId);
            finishedRentalTime += rental.endDate - rental.beginDate;

            rental.beginDate = 0;
            rental.endDate = 0;
        }

        return finishedRentalTime;
    }

    function _estimateNodeKeyPrice(uint256 totalEffectiveRentalTime_) internal pure returns (uint256) {
        return totalEffectiveRentalTime_;
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
