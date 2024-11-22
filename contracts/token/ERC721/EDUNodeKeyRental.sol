// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IEDUNodeKey} from "./interfaces/IEDUNodeKey.sol";
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
import "@openzeppelin/contracts/utils/math/Math.sol";

contract EDUNodeKeyRental is AccessControl, TokenRecovery, ForwarderRegistryContext {
    using AccessControlStorage for AccessControlStorage.Layout;
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;
    using Math for uint256;

    struct RentalInfo {
        uint256 beginDate;
        uint256 endDate;
    }

    /// @notice The role identifier for the operator role.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice The reason code for consuming points
    bytes32 public constant RENTAL_CONSUME_CODE = keccak256("NODE_KEY_RENTAL");

    uint256 constant POWER_10_18 = 10**18;
    uint256 constant LN2_WITH_POWER_10_18 = 693147180559945309; // ln(2) * 10^18 for fixed-point arithmetic

    Points public immutable POINTS;
    IEDUNodeKey public immutable NODE_KEY;

    uint256 public monthlyMaintenanceFee;
    uint256 public maxRentalDuration;
    uint256 public maxRentalCountPerCall;
    uint256 public nodeKeySupply;

    mapping(uint256 => RentalInfo) public rentals;

    uint256 public totalEffectiveRentalTime;

    event Rental(address indexed renter, uint256 tokenId, RentalInfo rental, uint256 fee);
    event BatchRental(address indexed renter, uint256[] tokenIds, RentalInfo[] rentals, uint256[] fees);
    event Collected(uint256[] tokenIds);
    event MonthlyMaintenanceFeeUpdated(uint256 newMonthlyMaintenanceFee);
    event MaxRentalDurationUpdated(uint256 newMaxRentalDuration);
    event MaxRentalCountPerCallUpdated(uint256 newMaxRentalCountPerCall);

    error InvalidTokenIdsParam();
    error ZeroRentalDuration(uint256 tokenId);
    error RentalDurationLimitExceeded(uint256 tokenId, uint256 duration);
    error RentalCountPerCallLimitExceeded();
    error TokenAlreadyRented(uint256 tokenId);
    error NotRented(uint256 tokenId);
    error TokenNotExpired(uint256 tokenId);
    error UnsupportedTokenId(uint256 tokenId);
    error FeeExceeded(uint256 calculatedFee, uint256 maxFee);

    constructor(
        address nodeKeyAddress,
        address pointsAddress,
        uint256 monthlyMaintenanceFee_,
        uint256 maxRentalDuration_,
        uint256 maxRentalCountPerCall_,
        uint256 nodeKeySupply_,
        IForwarderRegistry forwarderRegistry
    ) ContractOwnership(msg.sender) ForwarderRegistryContext(forwarderRegistry) {
        NODE_KEY = IEDUNodeKey(nodeKeyAddress);
        POINTS = Points(pointsAddress);
        monthlyMaintenanceFee = monthlyMaintenanceFee_;
        maxRentalDuration = maxRentalDuration_;
        maxRentalCountPerCall = maxRentalCountPerCall_;
        nodeKeySupply = nodeKeySupply_;
    }

    function calculateElapsedTimeForExpiredTokens(uint256[] calldata tokenIds) public view returns (uint256 elapsedTime) {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            RentalInfo storage rental = rentals[tokenId];
            if (rental.endDate == 0) {
                revert NotRented(tokenId);
            }

            if (block.timestamp < rental.endDate) {
                revert TokenNotExpired(tokenId);
            }

            elapsedTime += rental.endDate - rental.beginDate;
        }

        return elapsedTime;
    }

    function estimateRentalFee(
        address account,
        uint256 tokenId,
        uint256 duration,
        uint256[] calldata expiredTokenIds
    ) public view returns (uint256 fee) {
        uint256 elapsedTime = calculateElapsedTimeForExpiredTokens(expiredTokenIds);

        RentalInfo memory rental = rentals[tokenId];
        if (rental.endDate != 0) {
            uint256 currentTime = block.timestamp;
            if (currentTime >= rental.endDate) {
                elapsedTime += rental.endDate - rental.beginDate;
            } else if (NODE_KEY.ownerOf(tokenId) == account) {
                if (rental.endDate - rental.beginDate + duration > maxRentalDuration) {
                    revert RentalDurationLimitExceeded(tokenId, rental.endDate - rental.beginDate + duration);
                }
                elapsedTime += currentTime - rental.beginDate;
            } else {
                revert TokenAlreadyRented(tokenId);
            }
        }

        return _estimateNodeKeyPrice(totalEffectiveRentalTime - elapsedTime) + monthlyMaintenanceFee * duration;
    }

    function estimateBatchRentalFee(
        address account,
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
        uint256 totalDuration = 0;
        uint256 elapsedTime = calculateElapsedTimeForExpiredTokens(expiredTokenIds);
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 duration = durations[i];
            totalDuration += duration;
            uint256 tokenId = tokenIds[i];
            RentalInfo memory rental = rentals[tokenId];
            if (rental.endDate != 0) {
                if (currentTime >= rental.endDate) {
                    elapsedTime += rental.endDate - rental.beginDate;
                } else if (NODE_KEY.ownerOf(tokenId) == account) {
                    if (rental.endDate - rental.beginDate + duration > maxRentalDuration) {
                        revert RentalDurationLimitExceeded(tokenId, rental.endDate - rental.beginDate + duration);
                    }
                    elapsedTime += currentTime - rental.beginDate;
                } else {
                    revert TokenAlreadyRented(tokenId);
                }
            }
        }

        return _estimateNodeKeyPrice(totalEffectiveRentalTime - elapsedTime) * tokenIds.length + totalDuration * monthlyMaintenanceFee;
    }

    function rent(address account, uint256 tokenId, uint256 duration, uint256[] calldata expiredTokenIds, uint256 maxFee) public {
        uint256 currentTime = block.timestamp;
        uint256 expiredTokenElapsedTime = _collectExpiredTokens(expiredTokenIds, currentTime);

        (RentalInfo memory rental, uint256 elapsedTime) = _processRent(account, tokenId, duration, currentTime);

        uint256 preEffectiveRentalTime = totalEffectiveRentalTime - expiredTokenElapsedTime - elapsedTime;
        totalEffectiveRentalTime = preEffectiveRentalTime + duration;

        uint256 fee = _estimateNodeKeyPrice(preEffectiveRentalTime) + monthlyMaintenanceFee * duration;
        if (maxFee != 0 && fee > maxFee) {
            revert FeeExceeded(fee, maxFee);
        }

        POINTS.consume(_msgSender(), fee, RENTAL_CONSUME_CODE);
        emit Rental(account, tokenId, rental, fee);
    }

    function batchRent(
        address account,
        uint256[] calldata tokenIds,
        uint256[] calldata durations,
        uint256[] calldata expiredTokenIds,
        uint256 maxFee
    ) public {
        if (tokenIds.length >= maxRentalCountPerCall) {
            revert RentalCountPerCallLimitExceeded();
        }
        if (tokenIds.length != durations.length) {
            revert InconsistentArrayLengths();
        }

        address account_ = account;
        uint256[] memory tokenIds_ = tokenIds;
        uint256[] memory durations_ = durations;

        uint256 currentTime = block.timestamp;
        uint256 totalElapsedTime = _collectExpiredTokens(expiredTokenIds, currentTime);

        RentalInfo[] memory rentalInfos = new RentalInfo[](tokenIds.length);
        uint256[] memory fees = new uint256[](tokenIds.length);
        uint256 totalDuration;
        for (uint256 i = 0; i < tokenIds_.length; i++) {
            uint256 tokenId = tokenIds_[i];
            uint256 duration = durations_[i];
            (RentalInfo memory rental, uint256 elapsedTime) = _processRent(account_, tokenId, duration, currentTime);
            totalElapsedTime += elapsedTime;
            rentalInfos[i] = rental;
            fees[i] = monthlyMaintenanceFee * duration;
            totalDuration += duration;
        }

        uint256 preEffectiveRentalTime = totalEffectiveRentalTime - totalElapsedTime;
        totalEffectiveRentalTime = preEffectiveRentalTime + totalDuration;

        uint256 nodeKeyPrice = _estimateNodeKeyPrice(preEffectiveRentalTime);
        uint256 totalFee = nodeKeyPrice * tokenIds_.length + totalDuration * monthlyMaintenanceFee;
        for (uint256 i = 0; i < fees.length; i++) {
            fees[i] += nodeKeyPrice;
        }

        if (maxFee != 0 && totalFee > maxFee) {
            revert FeeExceeded(totalFee, maxFee);
        }

        POINTS.consume(_msgSender(), totalFee, RENTAL_CONSUME_CODE);
        emit BatchRental(account_, tokenIds_, rentalInfos, fees);
    }

    function _processRent(
        address account,
        uint256 tokenId,
        uint256 duration,
        uint256 currentTime
    ) internal returns (RentalInfo memory, uint256 elapsedTime) {
        if (duration == 0) {
            revert ZeroRentalDuration(tokenId);
        }

        if (duration > maxRentalDuration) {
            revert RentalDurationLimitExceeded(tokenId, duration);
        }

        if (tokenId >= nodeKeySupply) {
            revert UnsupportedTokenId(tokenId);
        }

        RentalInfo storage rental = rentals[tokenId];
        if (rental.endDate == 0) {
            NODE_KEY.safeMint(account, tokenId, "");
            rental.endDate = currentTime + duration;
        } else {
            address currentOwner = NODE_KEY.ownerOf(tokenId);
            if (currentTime >= rental.endDate) {
                elapsedTime = rental.endDate - rental.beginDate;
                rental.endDate = currentTime + duration;
                NODE_KEY.safeTransferFrom(currentOwner, account, tokenId);
            } else if (currentOwner == account) {
                if (rental.endDate - rental.beginDate + duration > maxRentalDuration) {
                    revert RentalDurationLimitExceeded(tokenId, rental.endDate - rental.beginDate + duration);
                }
                elapsedTime = currentTime - rental.beginDate;
                rental.endDate += duration;
            } else {
                revert TokenAlreadyRented(tokenId);
            }
        }

        rental.beginDate = currentTime;
        return (rental, elapsedTime);
    }

    function renterOf(uint256 tokenId) public view returns (address) {
        if (block.timestamp < rentals[tokenId].endDate) {
            return NODE_KEY.ownerOf(tokenId);
        } else {
            revert NotRented(tokenId);
        }
    }

    function setMonthlyMaintenanceFee(uint256 newMonthlyMaintenanceFee) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        monthlyMaintenanceFee = newMonthlyMaintenanceFee;
        emit MonthlyMaintenanceFeeUpdated(newMonthlyMaintenanceFee);
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
        totalEffectiveRentalTime -= finishedRentalTime;
    }

    function _collectExpiredTokens(uint256[] calldata tokenIds, uint256 blockTime) internal returns (uint256 finishedRentalTime) {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            RentalInfo storage rental = rentals[tokenId];
            if (rental.endDate != 0 && blockTime >= rental.endDate) {
                finishedRentalTime += rental.endDate - rental.beginDate;

                rental.beginDate = 0;
                rental.endDate = 0;

                address currentOwner = NODE_KEY.ownerOf(tokenId);
                NODE_KEY.burnFrom(currentOwner, tokenId);
            } else {
                revert TokenNotExpired(tokenId);
            }
        }

        if (tokenIds.length > 0) {
            emit Collected(tokenIds);
        }

        return finishedRentalTime;
    }

    function _estimateNodeKeyPrice(uint256 totalEffectiveRentalTime_) internal pure returns (uint256) {
        // ln(x) + ln(x / 100) * 500 
        return (Math.log2(totalEffectiveRentalTime_) + Math.log2(totalEffectiveRentalTime_ / 100)) * 500 * LN2_WITH_POWER_10_18 / POWER_10_18;
    }

    function estimateNodeKeyPriceTest(uint256 totalEffectiveRentalTime_) public pure returns (uint256) {
        return _estimateNodeKeyPrice(totalEffectiveRentalTime_);
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
