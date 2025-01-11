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
import {IEDULandPriceHelper} from "./interfaces/IEDULandPriceHelper.sol";

contract EDULandRental is AccessControl, TokenRecovery, ForwarderRegistryContext {
    using AccessControlStorage for AccessControlStorage.Layout;
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;

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

    /// @notice Emitted when tokens are rented.
    event Rental(address indexed renter, uint256[] tokenIds, uint256[] beginDates, uint256[] endDates, uint256[] fees);

    /// @notice Emitted when tokens are collected.
    event Collected(uint256[] tokenIds);

    /// @notice Emitted when the land price helper is updated.
    event LandPriceHelperUpdated(address newLandPriceHelper);

    /// @notice Emitted when max token supply is updated.
    event MaxTokenSupplyUpdated(uint256 newMaxTokenSupply);

    /// @notice Emitted when maintenance fee or/and maintenance fee denominator is/are updated.
    event MaintenanceFeeUpdated(uint256 newMaintenanceFee, uint256 newMaintenanceFeeDenominator);

    /// @notice Emitted when min rental duration is updated.
    event MinRentalDurationUpdated(uint256 newMinRentalDuration);

    /// @notice Emitted when max rental duration is updated.
    event MaxRentalDurationUpdated(uint256 newMaxRentalDuration);

    /// @notice Emitted when max rental count per call is updated.
    event MaxRentalCountPerCallUpdated(uint256 newMaxRentalCountPerCall);

    /// Custom errors
    error InvalidLandAddress();
    error InvalidPointsAddress();
    error InvalidTokenIdsParam();
    error RentalDurationTooLow(uint256 tokenId, uint256 duration);
    error RentalDurationTooHigh(uint256 tokenId, uint256 duration);
    error RentalCountPerCallLimitExceeded();
    error TokenAlreadyRented(uint256 tokenId);
    error TokenNotRented(uint256 tokenId);
    error TokenNotExpired(uint256 tokenId);
    error NoTokenCollected();
    error UnsupportedTokenId(uint256 tokenId);
    error FeeExceeded(uint256 calculatedFee, uint256 maxFee);

    /// @notice Constructor
    /// @dev Reverts if the landAddress or points address is a zero address.
    /// @dev ContractOwnership is required to initiate TokenRecovery
    /// @dev ForwarderRegistryContext is required to handle meta transactions
    /// @dev emits a {LandPriceHelperUpdated} event
    /// @dev emits a {MaintenanceFeeUpdated} event
    /// @dev emits a {MinRentalDurationUpdated} event
    /// @dev emits a {MaxRentalDurationUpdated} event
    /// @dev emits a {MaxRentalCountPerCallUpdated} event
    /// @dev emits a {MaxTokenSupplyUpdated} event
    /// @param landAddress The land address
    /// @param pointsAddress The points address
    /// @param landPriceHelperAddress The land price helper address
    /// @param maintenanceFee_ The maintenance fee
    /// @param maintenanceFeeDenominator_ The maintenance fee denominator
    /// @param minRentalDuration_ The minimum rental duration
    /// @param maxRentalDuration_ The maximum rental duration
    /// @param maxRentalCountPerCall_ The maximum rental count per call
    /// @param maxTokenSupply_ The maximum token supply
    /// @param forwarderRegistry The forwarder registry
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
        if (landAddress == address(0)) {
            revert InvalidLandAddress();
        }

        EDU_LAND = IEDULand(landAddress);

        if (pointsAddress == address(0)) {
            revert InvalidPointsAddress();
        }

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

    /// @notice Calculates the elapsed time for expired tokens. Non expired tokens are considered to have 0 elapsed time.
    /// @param tokenIds The tokenIds you are going to calculate the elapsed time for
    /// @return elapsedTime The elapsed time
    function calculateElapsedTimeForExpiredTokens(uint256[] calldata tokenIds) public view returns (uint256 elapsedTime) {
        uint256 currentTime = block.timestamp;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            RentalInfo storage rental = rentals[tokenId];
            uint256 rentalEndDate = rental.endDate;
            if (rentalEndDate != 0 && currentTime >= rentalEndDate) {
                elapsedTime += rentalEndDate - rental.beginDate;
            }
        }

        return elapsedTime;
    }

    /// @notice Estimates the current land price
    /// @param totalOngoingRentalTime_ The total ongoing rental time
    /// @return estimatedLandPrice The estimated land price
    function estimateLandPrice(uint256 totalOngoingRentalTime_) public view returns (uint256) {
        return landPriceHelper.calculatePrice(totalOngoingRentalTime_);
    }

    /// @notice Estimates the rental fee
    /// @dev Reverts if tokenIds and durations have inconsistent lengths
    /// @dev Reverts if the length of tokenIds is greater than maxRentalCountPerCall
    /// @dev Reverts if the tokenId is 0
    /// @dev Reverts if the tokenId is greater than maxTokenSupply
    /// @dev Reverts if the duration is greater than maxRentalDuration
    /// @dev Reverts if the duration is less than minRentalDuration
    /// @dev Reverts if the token is already rented
    /// @param tokenIds The tokens that you are going to rent
    /// @param durations The rental durations for each token
    /// @param expiredTokenIds The expired tokens that you are going to collect just before renting
    /// @return fee the estimated rental fee
    function estimateRentalFee(
        uint256[] calldata tokenIds,
        uint256[] calldata durations,
        uint256[] calldata expiredTokenIds
    ) public view returns (uint256 fee) {
        if (tokenIds.length != durations.length) {
            revert InconsistentArrayLengths();
        }

        if (tokenIds.length > maxRentalCountPerCall) {
            revert RentalCountPerCallLimitExceeded();
        }

        uint256 currentTime = block.timestamp;
        uint256 elapsedTime = calculateElapsedTimeForExpiredTokens(expiredTokenIds);
        uint256 landPrice = estimateLandPrice(totalOngoingRentalTime - elapsedTime);
        uint256 totalFee;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 duration = durations[i];
            uint256 tokenId = tokenIds[i];

            if (tokenId == 0) {
                revert UnsupportedTokenId(0);
            }

            if (tokenId > maxTokenSupply) {
                revert UnsupportedTokenId(tokenId);
            }

            if (duration > maxRentalDuration) {
                revert RentalDurationTooHigh(tokenId, duration);
            }

            RentalInfo memory rental = rentals[tokenId];
            if (rental.endDate == 0) {
                if (duration < minRentalDuration) {
                    revert RentalDurationTooLow(tokenId, duration);
                }

                totalFee += (duration * maintenanceFee) / maintenanceFeeDenominator;
            } else if (_msgSender() == EDU_LAND.ownerOf(tokenId) && currentTime < rental.endDate) {
                uint256 newEndDate = currentTime + duration;
                if (newEndDate - minRentalDuration < rental.endDate) {
                    revert RentalDurationTooLow(tokenId, duration);
                }

                uint256 extendedDuration = newEndDate - rental.endDate;
                totalFee += (extendedDuration * maintenanceFee) / maintenanceFeeDenominator;
            } else {
                if (duration < minRentalDuration) {
                    revert RentalDurationTooLow(tokenId, duration);
                }

                bool collected = false;
                for (uint256 j = 0; j < expiredTokenIds.length; j++) {
                    if (tokenId == expiredTokenIds[j]) {
                        collected = true;
                        break;
                    }
                }

                if (!collected) {
                    revert TokenAlreadyRented(tokenId);
                }

                totalFee += (duration * maintenanceFee) / maintenanceFeeDenominator;
            }
        }

        totalFee += landPrice * tokenIds.length;
        return totalFee;
    }

    /// @notice Rents the token(s)
    /// @dev Reverts if tokenIds and durations have inconsistent lengths
    /// @dev Reverts if the length of tokenIds is greater than maxRentalCountPerCall
    /// @dev Reverts if the tokenId is 0
    /// @dev Reverts if the tokenId is greater than maxTokenSupply
    /// @dev Reverts if the duration is greater than maxRentalDuration
    /// @dev Reverts if the duration is less than minRentalDuration
    /// @dev Reverts if the token is already rented
    /// @dev Reverts if the total fee is greater than maxFee
    /// @dev Emits a {Collected} event if at least one expired token is successfully being collected via this write function.
    /// @dev Emits a {Rental} event.
    /// @param tokenIds The tokens that you are going to rent
    /// @param durations The rental durations for each token
    /// @param expiredTokenIds The expired tokens that you are going to collect just before renting
    /// @param maxFee The maximum fee that you are going to pay
    function rent(uint256[] calldata tokenIds, uint256[] calldata durations, uint256[] calldata expiredTokenIds, uint256 maxFee) public {
        uint256[] memory tokenIds_ = tokenIds;
        uint256[] memory durations_ = durations;

        if (tokenIds_.length != durations_.length) {
            revert InconsistentArrayLengths();
        }

        if (tokenIds_.length > maxRentalCountPerCall) {
            revert RentalCountPerCallLimitExceeded();
        }

        uint256 currentTime = block.timestamp;
        uint256 postCollectionTotalOngoingRentalTime = totalOngoingRentalTime - _collectExpiredTokens(expiredTokenIds, currentTime, false);
        uint256 landPrice = estimateLandPrice(postCollectionTotalOngoingRentalTime);

        address account = _msgSender();

        uint256[] memory beginDates = new uint256[](tokenIds_.length);
        uint256[] memory endDates = new uint256[](tokenIds_.length);
        uint256[] memory fees = new uint256[](tokenIds_.length);
        uint256 totalFee;
        for (uint256 i = 0; i < tokenIds_.length; i++) {
            uint256 tokenId = tokenIds_[i];
            uint256 duration = durations_[i];

            if (tokenId == 0) {
                revert UnsupportedTokenId(0);
            }

            if (tokenId > maxTokenSupply) {
                revert UnsupportedTokenId(tokenId);
            }

            if (duration > maxRentalDuration) {
                revert RentalDurationTooHigh(tokenId, duration);
            }

            RentalInfo storage rental = rentals[tokenId];
            uint256 rentalEndDate = rental.endDate;
            if (rentalEndDate == 0) {
                if (duration < minRentalDuration) {
                    revert RentalDurationTooLow(tokenId, duration);
                }

                EDU_LAND.safeMint(account, tokenId, "");
                rental.beginDate = currentTime;
                uint256 endDate = currentTime + duration;
                rental.endDate = endDate;
                uint256 fee = landPrice + (duration * maintenanceFee) / maintenanceFeeDenominator;
                rental.fee = fee;
                totalFee += fee;
                postCollectionTotalOngoingRentalTime += duration;

                beginDates[i] = currentTime;
                endDates[i] = endDate;
                fees[i] = fee;
            } else if (account == EDU_LAND.ownerOf(tokenId) && currentTime < rentalEndDate) {
                uint256 newEndDate = currentTime + duration;
                if (newEndDate - minRentalDuration < rentalEndDate) {
                    revert RentalDurationTooLow(tokenId, duration);
                }

                uint256 extendedDuration = newEndDate - rentalEndDate;
                rental.endDate = newEndDate;
                uint256 fee = landPrice + (extendedDuration * maintenanceFee) / maintenanceFeeDenominator;
                rental.fee += fee;
                totalFee += fee;
                postCollectionTotalOngoingRentalTime += extendedDuration;

                beginDates[i] = rentalEndDate;
                endDates[i] = newEndDate;
                fees[i] = fee;
            } else {
                revert TokenAlreadyRented(tokenId);
            }
        }

        if (maxFee != 0 && totalFee > maxFee) {
            revert FeeExceeded(totalFee, maxFee);
        }

        totalOngoingRentalTime = postCollectionTotalOngoingRentalTime;

        POINTS.consume(account, totalFee, RENTAL_CONSUME_CODE);
        emit Rental(account, tokenIds_, beginDates, endDates, fees);
    }

    /// @notice Sets the land price helper address
    /// @dev Reverts with {NotRoleHolder} if the sender is not the operator.
    /// @dev Emits a {LandPriceHelperUpdated} event.
    /// @param newLandPriceHelper The new land price helper address to set
    function setLandPriceHelper(address newLandPriceHelper) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        landPriceHelper = IEDULandPriceHelper(newLandPriceHelper);
        emit LandPriceHelperUpdated(newLandPriceHelper);
    }

    /// @notice Sets the max token supply
    /// @dev Reverts with {NotRoleHolder} if the sender is not the operator.
    /// @dev Emits a {MaxTokenSupplyUpdated} event.
    /// @param newMaxTokenSupply The new max token supply to set
    function setMaxTokenSupply(uint256 newMaxTokenSupply) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        maxTokenSupply = newMaxTokenSupply;
        emit MaxTokenSupplyUpdated(newMaxTokenSupply);
    }

    /// @notice Sets the maintenance fee and maintenance fee denominator
    /// @dev Reverts with {NotRoleHolder} if the sender is not the operator.
    /// @dev Emits a {MaintenanceFeeUpdated} event.
    /// @param newMaintenanceFee The new maintenance fee to set
    /// @param newMaintenanceFeeDenominator The new maintenance fee denominator to set
    function setMaintenanceFee(uint256 newMaintenanceFee, uint256 newMaintenanceFeeDenominator) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        maintenanceFee = newMaintenanceFee;
        maintenanceFeeDenominator = newMaintenanceFeeDenominator;
        emit MaintenanceFeeUpdated(newMaintenanceFee, newMaintenanceFeeDenominator);
    }

    /// @notice Sets the min rental duration
    /// @dev Reverts with {NotRoleHolder} if the sender is not the operator.
    /// @dev Emits a {MinRentalDurationUpdated} event.
    /// @param newMinRentalDuration The new min rental duration to set
    function setMinRentalDuration(uint256 newMinRentalDuration) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        minRentalDuration = newMinRentalDuration;
        emit MinRentalDurationUpdated(newMinRentalDuration);
    }

    /// @notice Sets the max rental duration
    /// @dev Reverts with {NotRoleHolder} if the sender is not the operator.
    /// @dev Emits a {MaxRentalDurationUpdated} event.
    /// @param newMaxRentalDuration The new max rental duration to set
    function setMaxRentalDuration(uint256 newMaxRentalDuration) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        maxRentalDuration = newMaxRentalDuration;
        emit MaxRentalDurationUpdated(newMaxRentalDuration);
    }

    /// @notice Sets the max rental count per call
    /// @dev Reverts with {NotRoleHolder} if the sender is not the operator.
    /// @dev Emits a {MaxRentalCountPerCallUpdated} event.
    /// @param newRentalCountPerCall The new max rental count per call to set
    function setMaxRentalCountPerCall(uint256 newRentalCountPerCall) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        maxRentalCountPerCall = newRentalCountPerCall;
        emit MaxRentalCountPerCallUpdated(newRentalCountPerCall);
    }

    /// @notice Collects the expired tokens
    /// @dev Emits a {Collected} event.
    /// @param tokenIds The tokens that you are going to collect
    function collectExpiredTokens(uint256[] calldata tokenIds) public {
        uint256 elapsedRentalTime = _collectExpiredTokens(tokenIds, block.timestamp, true);
        totalOngoingRentalTime -= elapsedRentalTime;
    }

    /// @notice Collects the expired tokens
    /// @dev Emits a {Collected} event if at least one expired token is successfully being collected via this function.
    /// @param tokenIds The tokens that you are going to collect
    /// @return elapsedRentalTime The elapsed rental time
    function _collectExpiredTokens(
        uint256[] calldata tokenIds,
        uint256 blockTime,
        bool revertOnCollectionFailed
    ) internal returns (uint256 elapsedRentalTime) {
        uint256[] memory collectedTokenIds = new uint256[](tokenIds.length);
        bool hasExpiredToken = false;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            RentalInfo storage rental = rentals[tokenId];
            uint256 rentalEndDate = rental.endDate;
            if (rentalEndDate != 0 && blockTime >= rentalEndDate) {
                elapsedRentalTime += rentalEndDate - rental.beginDate;

                rental.beginDate = 0;
                rental.endDate = 0;
                rental.fee = 0;

                address currentOwner = EDU_LAND.ownerOf(tokenId);
                EDU_LAND.burnFrom(currentOwner, tokenId);
                collectedTokenIds[i] = tokenId;
                hasExpiredToken = true;
            } else if (revertOnCollectionFailed) {
                revert TokenNotExpired(tokenId);
            }
        }

        if (hasExpiredToken) {
            emit Collected(collectedTokenIds);
        } else if (revertOnCollectionFailed) {
            revert NoTokenCollected();
        }

        return elapsedRentalTime;
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
