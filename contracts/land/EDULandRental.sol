// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IEDULand} from "./interfaces/IEDULand.sol";
import {Points} from "@animoca/anichess-ethereum-contracts-2.2.3/contracts/points/Points.sol";
import {AccessControl} from "@animoca/ethereum-contracts/contracts/access/AccessControl.sol";
import {AccessControlStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/AccessControlStorage.sol";
import {ContractOwnershipStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/ContractOwnershipStorage.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {TokenRecovery} from "@animoca/ethereum-contracts/contracts/security/TokenRecovery.sol";
import {InconsistentArrayLengths} from "@animoca/ethereum-contracts/contracts/CommonErrors.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {ForwarderRegistryContext} from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IEDULandPriceHelper} from "./interfaces/IEDULandPriceHelper.sol";

contract EDULandRental is AccessControl, TokenRecovery, ForwarderRegistryContext {
    using AccessControlStorage for AccessControlStorage.Layout;
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;
    using Math for uint256;

    struct RentalInfo {
        uint256 beginDate;
        uint256 endDate;
        uint256 fee;
    }

    /// @notice The role identifier for the operator role.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice The reason code for consuming points
    bytes32 public constant RENTAL_CONSUME_CODE = keccak256("EDU_LAND_RENTAL");

    Points public immutable POINTS;
    IEDULand public immutable EDU_LAND;

    IEDULandPriceHelper public landPriceHelper;

    uint256 public maxTokenSupply;
    uint256 public maintenanceFee;
    uint256 public maintenanceFeeDenominator;
    uint256 public minRentalDuration;
    uint256 public maxRentalDuration;
    uint256 public maxRentalCountPerCall;

    mapping(uint256 => RentalInfo) public rentals;

    uint256 public totalOngoingRentalTime;

    event Rental(address indexed renter, uint256[] tokenIds, RentalInfo[] rentals);
    event Collected(uint256[] tokenIds);
    event LandPriceHelperUpdated(address newRentalFeeHelper);
    event MaxTokenSupplyUpdated(uint256 newMaxTokenSupply);
    event MaintenanceFeeUpdated(uint256 newMaintenanceFee, uint256 newMaintenanceFeeDenominator);
    event MinRentalDurationUpdated(uint256 newMinRentalDuration);
    event MaxRentalDurationUpdated(uint256 newMaxRentalDuration);
    event MaxRentalCountPerCallUpdated(uint256 newMaxRentalCountPerCall);

    error InvalidTokenIdsParam();
    error RentalDurationTooLow(uint256 tokenId, uint256 duration, uint256 limit);
    error RentalDurationTooHigh(uint256 tokenId, uint256 duration, uint256 limit);
    error RentalCountPerCallLimitExceeded();
    error TokenAlreadyRented(uint256 tokenId);
    error TokenNotRented(uint256 tokenId);
    error TokenNotExpired(uint256 tokenId);
    error UnsupportedTokenId(uint256 tokenId);
    error FeeExceeded(uint256 calculatedFee, uint256 maxFee);

    constructor(
        address landAddress,
        address pointsAddress,
        address landPriceHelperAddress,
        uint256 maintenanceFee_,
        uint256 maintenanceFeeDenominator_,
        uint256 minRentalDuration_,
        uint256 maxRentalDuration_,
        uint256 maxRentalCountPerCall_,
        uint256 maxTokenSupply_,
        IForwarderRegistry forwarderRegistry
    ) ContractOwnership(msg.sender) ForwarderRegistryContext(forwarderRegistry) {
        EDU_LAND = IEDULand(landAddress);
        POINTS = Points(pointsAddress);

        landPriceHelper = IEDULandPriceHelper(landPriceHelperAddress);
        emit LandPriceHelperUpdated(landPriceHelperAddress);

        maintenanceFee = maintenanceFee_;
        maintenanceFeeDenominator = maintenanceFeeDenominator_;
        emit MaintenanceFeeUpdated(maintenanceFee_, maintenanceFeeDenominator_);

        minRentalDuration = minRentalDuration_;
        emit MinRentalDurationUpdated(minRentalDuration_);

        maxRentalDuration = maxRentalDuration_;
        emit MaxRentalDurationUpdated(maxRentalDuration_);

        maxRentalCountPerCall = maxRentalCountPerCall_;
        emit MaxRentalCountPerCallUpdated(maxRentalCountPerCall_);

        maxTokenSupply = maxTokenSupply_;
        emit MaxTokenSupplyUpdated(maxTokenSupply_);
    }

    function calculateElapsedTimeForExpiredTokens(uint256[] calldata tokenIds) public view returns (uint256 elapsedTime) {
        uint256 currentTime = block.timestamp;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            RentalInfo storage rental = rentals[tokenId];
            if (rental.endDate == 0) {
                revert TokenNotRented(tokenId);
            }

            if (currentTime < rental.endDate) {
                revert TokenNotExpired(tokenId);
            }

            elapsedTime += rental.endDate - rental.beginDate;
        }

        return elapsedTime;
    }

    function estimateRentalFee(
        uint256[] calldata tokenIds,
        uint256[] calldata durations,
        uint256[] calldata expiredTokenIds
    ) public view returns (uint256 fee) {
        if (tokenIds.length >= maxRentalCountPerCall) {
            revert RentalCountPerCallLimitExceeded();
        }

        if (tokenIds.length != durations.length) {
            revert InconsistentArrayLengths();
        }

        uint256 currentTime = block.timestamp;
        uint256 elapsedTime = calculateElapsedTimeForExpiredTokens(expiredTokenIds);
        uint256 landPrice = _estimateLandPrice(totalOngoingRentalTime - elapsedTime);
        uint256 totalFee;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 duration = durations[i];
            uint256 tokenId = tokenIds[i];

            if (tokenId == 0) {
                revert UnsupportedTokenId(0);
            }

            if (tokenId >= maxTokenSupply) {
                revert UnsupportedTokenId(tokenId);
            }

            if (duration < minRentalDuration) {
                revert RentalDurationTooLow(tokenId, duration, minRentalDuration);
            }

            if (duration > maxRentalDuration) {
                revert RentalDurationTooHigh(tokenId, duration, maxRentalDuration);
            }

            RentalInfo memory rental = rentals[tokenId];
            if (rental.endDate == 0) {
                totalFee += landPrice + (duration * maintenanceFee) / maintenanceFeeDenominator;
            } else if (EDU_LAND.ownerOf(tokenId) == _msgSender && currentTime < rental.endDate) {
                uint256 extendedDuration = currentTime + duration - rental.endDate;
                totalFee += (extendedDuration * maintenanceFee) / maintenanceFeeDenominator;
            } else {
                revert TokenAlreadyRented(tokenId);
            }
        }

        return totalFee;
    }

    function rent(uint256[] calldata tokenIds, uint256[] calldata durations, uint256[] calldata expiredTokenIds, uint256 maxFee) public {
        if (tokenIds.length >= maxRentalCountPerCall) {
            revert RentalCountPerCallLimitExceeded();
        }
        if (tokenIds.length != durations.length) {
            revert InconsistentArrayLengths();
        }

        address account = _msgSender();
        uint256[] memory tokenIds_ = tokenIds;
        uint256[] memory durations_ = durations;

        uint256 currentTime = block.timestamp;
        uint256 postCollectionTotalOngoingRentalTime = totalOngoingRentalTime - _collectExpiredTokens(expiredTokenIds, currentTime);
        uint256 landPrice = _estimateLandPrice(postCollectionTotalOngoingRentalTime);

        RentalInfo[] memory rentalInfos = new RentalInfo[](tokenIds.length);
        uint256 totalDuration;
        uint256 totalFee;
        for (uint256 i = 0; i < tokenIds_.length; i++) {
            uint256 tokenId = tokenIds_[i];
            uint256 duration = durations_[i];

            if (tokenId == 0) {
                revert UnsupportedTokenId(0);
            }

            if (tokenId >= maxTokenSupply) {
                revert UnsupportedTokenId(tokenId);
            }

            if (duration < minRentalDuration) {
                revert RentalDurationTooLow(tokenId, duration, minRentalDuration);
            }

            if (duration > maxRentalDuration) {
                revert RentalDurationTooHigh(tokenId, duration, maxRentalDuration);
            }

            RentalInfo storage rental = rentals[tokenId];
            if (rental.endDate == 0) {
                EDU_LAND.safeMint(account, tokenId, "");
                rental.beginDate = currentTime;
                rental.endDate = currentTime + duration;
                uint256 fee = landPrice + (duration * maintenanceFee) / maintenanceFeeDenominator;
                rental.fee = fee;
                totalFee += fee;
            } else if (account == EDU_LAND.ownerOf(tokenId) && currentTime < rental.endDate) {
                uint256 newEndDate = currentTime + duration;
                uint256 extendedDuration = newEndDate - rental.endDate;
                rental.endDate = newEndDate;
                uint256 fee = (extendedDuration * maintenanceFee) / maintenanceFeeDenominator;
                rental.fee += fee;
                totalFee += fee;
            } else {
                revert TokenAlreadyRented(tokenId);
            }

            rentalInfos[i] = rental;
            totalDuration += duration;
        }

        if (maxFee != 0 && totalFee > maxFee) {
            revert FeeExceeded(totalFee, maxFee);
        }

        totalOngoingRentalTime = postCollectionTotalOngoingRentalTime + totalDuration;

        POINTS.consume(account, totalFee, RENTAL_CONSUME_CODE);
        emit Rental(account, tokenIds_, rentalInfos);
    }

    function renterOf(uint256 tokenId) public view returns (address) {
        if (block.timestamp < rentals[tokenId].endDate) {
            return EDU_LAND.ownerOf(tokenId);
        } else {
            revert TokenNotRented(tokenId);
        }
    }

    function setLandPriceHelper(address newLandPriceHelper) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        landPriceHelper = IEDULandPriceHelper(newLandPriceHelper);
        emit LandPriceHelperUpdated(newLandPriceHelper);
    }

    function setMaxTokenSupply(uint256 newMaxTokenSupply) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        maxTokenSupply = newMaxTokenSupply;
        emit MaxTokenSupplyUpdated(newMaxTokenSupply);
    }

    function setMaintenanceFee(uint256 newMaintenanceFee, uint256 newMaintenanceFeeDenominator) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        maintenanceFee = newMaintenanceFee;
        maintenanceFeeDenominator = newMaintenanceFeeDenominator;
        emit MaintenanceFeeUpdated(newMaintenanceFee, newMaintenanceFeeDenominator);
    }

    function setMinRentalDuration(uint256 newMinRentalDuration) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        minRentalDuration = newMinRentalDuration;
        emit MinRentalDurationUpdated(newMinRentalDuration);
    }

    function setMaxRentalDuration(uint256 newMaxRentalDuration) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        maxRentalDuration = newMaxRentalDuration;
        emit MaxRentalDurationUpdated(newMaxRentalDuration);
    }

    function setMaxRentalCountPerCall(uint256 newRentalCountPerCall) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        maxRentalCountPerCall = newRentalCountPerCall;
        emit MaxRentalCountPerCallUpdated(newRentalCountPerCall);
    }

    function collectExpiredTokens(uint256[] calldata tokenIds) public {
        uint256 finishedRentalTime = _collectExpiredTokens(tokenIds, block.timestamp);
        totalOngoingRentalTime -= finishedRentalTime;
    }

    function _collectExpiredTokens(uint256[] calldata tokenIds, uint256 blockTime) internal returns (uint256 finishedRentalTime) {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            RentalInfo storage rental = rentals[tokenId];
            if (rental.endDate != 0 && blockTime >= rental.endDate) {
                finishedRentalTime += rental.endDate - rental.beginDate;

                rental.beginDate = 0;
                rental.endDate = 0;
                rental.fee = 0;

                address currentOwner = EDU_LAND.ownerOf(tokenId);
                EDU_LAND.burnFrom(currentOwner, tokenId);
            } else {
                revert TokenNotExpired(tokenId);
            }
        }

        if (tokenIds.length > 0) {
            emit Collected(tokenIds);
        }

        return finishedRentalTime;
    }

    function _estimateLandPrice(uint256 totalOngoingRentalTime_) internal view returns (uint256) {
        return landPriceHelper.calculatePrice(totalOngoingRentalTime_);
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
