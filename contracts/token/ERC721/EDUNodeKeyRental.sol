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
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract EDUNodeKeyRental is AccessControl, TokenRecovery, ForwarderRegistryContext {
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
    bytes32 public constant RENTAL_CONSUME_CODE = keccak256("NODE_KEY_RENTAL");

    uint256 internal constant POWER_10_18 = 10 ** 18;
    uint256 internal constant LN2_WITH_POWER_10_18 = 693147180559945309; // ln(2) * 10^18 for fixed-point arithmetic

    Points public immutable POINTS;
    IEDUNodeKey public immutable NODE_KEY;

    uint256 public maxTokenSupply;
    uint256 public maintenanceFee;
    uint256 public maxRentalDuration;
    uint256 public maxRentalCountPerCall;

    mapping(uint256 => RentalInfo) public rentals;

    uint256 public totalEffectiveRentalTime;

    event Rental(address indexed renter, uint256[] tokenIds, RentalInfo[] rentals);
    event Collected(uint256[] tokenIds);
    event MaxTokenSupplyUpdated(uint256 newMaxTokenSupply);
    event MaintenanceFeeUpdated(uint256 newMaintenanceFee);
    event MaxRentalDurationUpdated(uint256 newMaxRentalDuration);
    event MaxRentalCountPerCallUpdated(uint256 newMaxRentalCountPerCall);

    error InvalidTokenIdsParam();
    error ZeroRentalDuration(uint256 tokenId);
    error RentalDurationLimitExceeded(uint256 tokenId, uint256 duration);
    error RentalCountPerCallLimitExceeded();
    error TokenAlreadyRented(uint256 tokenId);
    error TokenNotRented(uint256 tokenId);
    error TokenNotExpired(uint256 tokenId);
    error UnsupportedTokenId(uint256 tokenId);
    error FeeExceeded(uint256 calculatedFee, uint256 maxFee);

    constructor(
        address nodeKeyAddress,
        address pointsAddress,
        uint256 maintenanceFee_,
        uint256 maxRentalDuration_,
        uint256 maxRentalCountPerCall_,
        uint256 maxTokenSupply_,
        IForwarderRegistry forwarderRegistry
    ) ContractOwnership(msg.sender) ForwarderRegistryContext(forwarderRegistry) {
        NODE_KEY = IEDUNodeKey(nodeKeyAddress);
        POINTS = Points(pointsAddress);
        maintenanceFee = maintenanceFee_;
        maxRentalDuration = maxRentalDuration_;
        maxRentalCountPerCall = maxRentalCountPerCall_;
        maxTokenSupply = maxTokenSupply_;
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
        uint256 elapsedTime = calculateElapsedTimeForExpiredTokens(expiredTokenIds);
        uint256 nodeKeyPrice = _estimateNodeKeyPrice(totalEffectiveRentalTime - elapsedTime);
        uint256 totalFee;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 duration = durations[i];
            uint256 tokenId = tokenIds[i];
            if (duration == 0) {
                revert ZeroRentalDuration(tokenId);
            }

            if (tokenId >= maxTokenSupply) {
                revert UnsupportedTokenId(tokenId);
            }

            RentalInfo memory rental = rentals[tokenId];
            if (rental.endDate == 0) {
                if (duration > maxRentalDuration) {
                    revert RentalDurationLimitExceeded(tokenId, duration);
                }

                totalFee += nodeKeyPrice;
            } else if (NODE_KEY.ownerOf(tokenId) == account && currentTime < rental.endDate) {
                if (rental.endDate - rental.beginDate + duration > maxRentalDuration) {
                    revert RentalDurationLimitExceeded(tokenId, rental.endDate - rental.beginDate + duration);
                }
            } else {
                revert TokenAlreadyRented(tokenId);
            }

            totalFee += duration * maintenanceFee;
        }

        return totalFee;
    }

    function rent(
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
        uint256 preEffectiveRentalTime = totalEffectiveRentalTime - _collectExpiredTokens(expiredTokenIds, currentTime);
        uint256 nodeKeyPrice = _estimateNodeKeyPrice(preEffectiveRentalTime);

        RentalInfo[] memory rentalInfos = new RentalInfo[](tokenIds.length);
        uint256 totalDuration;
        uint256 totalFee;
        for (uint256 i = 0; i < tokenIds_.length; i++) {
            uint256 tokenId = tokenIds_[i];
            uint256 duration = durations_[i];
            if (duration == 0) {
                revert ZeroRentalDuration(tokenId);
            }

            if (tokenId >= maxTokenSupply) {
                revert UnsupportedTokenId(tokenId);
            }

            RentalInfo storage rental = rentals[tokenId];
            if (rental.endDate == 0) {
                if (duration > maxRentalDuration) {
                    revert RentalDurationLimitExceeded(tokenId, duration);
                }

                NODE_KEY.safeMint(account_, tokenId, "");
                rental.beginDate = currentTime;
                rental.endDate = currentTime + duration;
                uint256 fee = nodeKeyPrice + maintenanceFee * duration;
                rental.fee = fee;
                totalFee += fee;
            } else if (account_ == NODE_KEY.ownerOf(tokenId) && currentTime < rental.endDate) {
                if (rental.endDate - rental.beginDate + duration > maxRentalDuration) {
                    revert RentalDurationLimitExceeded(tokenId, rental.endDate - rental.beginDate + duration);
                }

                rental.endDate += duration;
                uint256 fee = maintenanceFee * duration;
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

        totalEffectiveRentalTime = preEffectiveRentalTime + totalDuration;

        POINTS.consume(_msgSender(), totalFee, RENTAL_CONSUME_CODE);
        emit Rental(account_, tokenIds_, rentalInfos);
    }

    function renterOf(uint256 tokenId) public view returns (address) {
        if (block.timestamp < rentals[tokenId].endDate) {
            return NODE_KEY.ownerOf(tokenId);
        } else {
            revert TokenNotRented(tokenId);
        }
    }

    function setMaxTokenSupply(uint256 newMaxTokenSupply) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        maxTokenSupply = newMaxTokenSupply;
        emit MaxTokenSupplyUpdated(newMaxTokenSupply);
    }

    function setMaintenanceFee(uint256 newMaintenanceFee) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        maintenanceFee = newMaintenanceFee;
        emit MaintenanceFeeUpdated(newMaintenanceFee);
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
                rental.fee = 0;

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
        return ((Math.log2(totalEffectiveRentalTime_) + Math.log2(totalEffectiveRentalTime_ / 100)) * 500 * LN2_WITH_POWER_10_18) / POWER_10_18;
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
