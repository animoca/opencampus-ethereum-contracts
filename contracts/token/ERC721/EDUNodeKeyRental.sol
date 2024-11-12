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

contract EDUNodeKeyRental is AccessControl, TokenRecovery, ForwarderRegistryContext {
    using AccessControlStorage for AccessControlStorage.Layout;
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;

    struct RentalInfo {
        uint256 beginDate;
        uint256 endDate;
    }

    /// @notice The role identifier for the operator role.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice The reason code for consuming points
    bytes32 public constant RENTAL_CONSUME_CODE = keccak256("NODE_KEY_RENTAL");

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
    error ZeroRentalDuration();
    error RentalDurationLimitExceeded(uint256 tokenId, uint256 duration);
    error RentalCountPerCallLimitExceeded();
    error NotRentable(uint256 tokenId);
    error NotRented(uint256 tokenId);
    error NotCollectable(uint256 tokenId);
    error UnsupportedTokenId(uint256 tokenId);
    
    error Test(uint256 current, uint256 beginDate, uint256 endDate);
    error TestUint256(uint256 val);

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

    function estimateNodeKeyPrice(uint256 duration, uint256[] calldata expiredNodeKeyIds) public view returns (uint256 fee) {
        uint256 finishedRentalTime = 0;
        for (uint256 i = 0; i < expiredNodeKeyIds.length; i++) {
            uint256 tokenId = expiredNodeKeyIds[i];
            address currentOwner = NODE_KEY.ownerOf(tokenId);
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

    function rentWithStrictCollection(address account, uint256 tokenId, uint256 duration, uint256[] calldata expiredNodeKeyIds) public {
        _rent(account, tokenId, duration, expiredNodeKeyIds, true);
    }

    function rentWithFlexibleCollection(address account, uint256 tokenId, uint256 duration, uint256[] calldata expiredNodeKeyIds) public {
        _rent(account, tokenId, duration, expiredNodeKeyIds, false);
    }

    function batchRentWithStrictCollection(address account, uint256[] calldata tokenIds, uint256[] calldata durations, uint256[] calldata expiredNodeKeyIds) public {
        _batchRent(account, tokenIds, durations, expiredNodeKeyIds, true);
    }

    function batchRentWithFlexibleCollection(address account, uint256[] calldata tokenIds, uint256[] calldata durations, uint256[] calldata expiredNodeKeyIds) public {
        _batchRent(account, tokenIds, durations, expiredNodeKeyIds, false);
    }

    function _rent(address account, uint256 tokenId, uint256 duration, uint256[] calldata expiredNodeKeyIds, bool requireSuccessOnCollect) internal {
        uint256 currentTime = block.timestamp;
        uint256 finishedRentalTime = _collectExpiredTokens(expiredNodeKeyIds, currentTime, requireSuccessOnCollect);

        (RentalInfo memory rental, uint256 maintenanceFee, uint256 elaspedTime) = _processRent(account, tokenId, duration, currentTime);
        uint256 preEffectiveRentalTime = totalEffectiveRentalTime - finishedRentalTime - elaspedTime;
        uint256 nodeKeyPrice = _estimateNodeKeyPrice(preEffectiveRentalTime);
        totalEffectiveRentalTime = preEffectiveRentalTime + duration;

        uint256 fee = nodeKeyPrice + maintenanceFee;
        POINTS.consume(_msgSender(), fee, RENTAL_CONSUME_CODE);
        emit Rental(account, tokenId, rental, fee);
    }

    function _batchRent(address account, uint256[] calldata tokenIds, uint256[] calldata durations, uint256[] calldata expiredNodeKeyIds, bool requireSuccessOnCollect) internal {
        if (tokenIds.length >= maxRentalCountPerCall) {
            revert RentalCountPerCallLimitExceeded();
        }
        if (tokenIds.length != durations.length) {
            revert InconsistentArrayLengths();
        }

        address account_ = account;
        uint256[] memory tokenIds_ = tokenIds;
        uint256[] memory durations_ = durations;
        uint256[] memory expiredNodeKeyIds_ = expiredNodeKeyIds;

        uint256 currentTime = block.timestamp;
        uint256 finishedRentalTime = _collectExpiredTokens(expiredNodeKeyIds_, currentTime, requireSuccessOnCollect);

        RentalInfo[] memory rentalInfos;
        uint256[] memory fees;
        uint256 totalFee;
        for (uint256 i = 0; i < tokenIds_.length; i++) {
            uint256 tokenId = tokenIds_[i];
            (RentalInfo memory rental, uint256 maintenanceFee, uint256 elaspedTime) = _processRent(account_, tokenId, durations_[i], currentTime);
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

    function _processRent(
        address account,
        uint256 tokenId,
        uint256 duration,
        uint256 currentTime
    ) internal returns (RentalInfo memory, uint256, uint256 elaspedRentalTime) {
        if (duration == 0) {
            revert ZeroRentalDuration();
        }

        if (duration >= maxRentalDuration) {
            revert RentalDurationLimitExceeded(tokenId, duration);
        }

        if (tokenId >= nodeKeySupply) {
            revert UnsupportedTokenId(tokenId);
        }

        RentalInfo storage rental = rentals[tokenId];
        if (rental.endDate != 0) {
            if (currentTime >= rental.endDate) {
                elaspedRentalTime = rental.endDate - rental.beginDate;
            } else if (account == NODE_KEY.ownerOf(tokenId)) {
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
            NODE_KEY.safeMint(account, tokenId, "");
        } else {
            // Extend the period
            rental.beginDate = currentExpiry;
            rental.endDate = currentExpiry + duration;
        }

        return (rental, monthlyMaintenanceFee * duration, elaspedRentalTime);
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
        uint256 finishedRentalTime = _collectExpiredTokens(tokenIds, block.timestamp, true);
        totalEffectiveRentalTime -= finishedRentalTime;
    }

    function _collectExpiredTokens(uint256[] memory tokenIds, uint256 blockTime, bool requireSuccess) internal returns (uint256 finishedRentalTime) {
        uint256[] memory collectibleTokenIds;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            RentalInfo storage rental = rentals[tokenId];
            if (rental.endDate != 0 && blockTime >= rental.endDate) {
                collectibleTokenIds[collectibleTokenIds.length - 1] = tokenId;
                finishedRentalTime += rental.endDate - rental.beginDate;

                rental.beginDate = 0;
                rental.endDate = 0;

                address currentOwner = NODE_KEY.ownerOf(tokenId);
                NODE_KEY.burnFrom(currentOwner, tokenId);
            } else if (requireSuccess) {
                revert NotCollectable(tokenId);
            }
        }

        if (collectibleTokenIds.length > 0) {
            emit Collected(collectibleTokenIds);
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
