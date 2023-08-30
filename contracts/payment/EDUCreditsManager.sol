// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {InconsistentArrayLengths} from "@animoca/ethereum-contracts/contracts/CommonErrors.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Receiver} from "@animoca/ethereum-contracts/contracts/token/ERC20/interfaces/IERC20Receiver.sol";
import {ContractOwnershipStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/ContractOwnershipStorage.sol";
import {AccessControlStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/AccessControlStorage.sol";
import {PayoutWalletStorage} from "@animoca/ethereum-contracts/contracts/payment/libraries/PayoutWalletStorage.sol";
import {ERC20Storage} from "@animoca/ethereum-contracts/contracts/token/ERC20/libraries/ERC20Storage.sol";
import {PayoutWallet} from "@animoca/ethereum-contracts/contracts/payment/PayoutWallet.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {AccessControl} from "@animoca/ethereum-contracts/contracts/access/AccessControl.sol";
import {ERC20Receiver} from "@animoca/ethereum-contracts/contracts/token/ERC20/ERC20Receiver.sol";
import {TokenRecoveryBase} from "@animoca/ethereum-contracts/contracts/security/base/TokenRecoveryBase.sol";
import {TokenRecovery} from "@animoca/ethereum-contracts/contracts/security/TokenRecovery.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {ForwarderRegistryContext} from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";

/// @title DepositManager
/// @notice Manages the users credits of unclaimed and bonus EDU tokens previously acquired during the genesis sale (during the init phase).
/// @notice Handles the deposit of EDU tokens by users (during the deposit phase).
/// @notice Handles the spending of all 3 user credits (unclaimed, bonus and deposited) by a spender contract (during the sale phase).
/// @notice Handles the withdrawal of remaining deposited EDU by users (during the withdrawal phase).
contract EDUCreditsManager is PayoutWallet, ERC20Receiver, AccessControl, TokenRecovery, ForwarderRegistryContext {
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;
    using PayoutWalletStorage for PayoutWalletStorage.Layout;
    using AccessControlStorage for AccessControlStorage.Layout;

    struct UserCredits {
        uint256 unclaimed; // unclaimed EDU credits from the genesis mint
        uint256 bonus; // bonus EDU credits from the genesis mint
        uint256 deposited; // deposited EDU credits from the user
        bool diamondHand; // whether the user is a diamond hand, ie. didn't claim any from the genesis mint
    }

    bytes32 public constant SPENDER_ROLE = "spender";

    uint256 public constant INIT_PHASE = 0;
    uint256 public constant DEPOSIT_PHASE = 1;
    uint256 public constant SALE_PHASE = 2;
    uint256 public constant WITHDRAW_PHASE = 3;

    IERC20 public immutable EDU_TOKEN;
    address public immutable UNCLAIMED_EDU_HOLDER;

    uint256 public currentPhase = INIT_PHASE;

    mapping(address => UserCredits) public userCredits;

    /// @notice The total credits is the sum of all unclaimed, bonus and deposited credits.
    /// @notice The total credits does not decrease when credits are spent or withdrawn.
    uint256 public totalCredits;

    /// @notice The total deposited is the sum of all deposited credits.
    /// @notice The total deposited decreases when unclaimed credits are spent or withdrawn.
    uint256 public totalDeposited;

    /// @notice Emitted when the current phase is set.
    /// @param phase the phase set.
    event PhaseSet(uint256 phase);

    /// @notice Emitted when the initial credits are set.
    /// @param users the users whose credits are set.
    /// @param unclaimed the unclaimed EDU credits.
    /// @param bonus the bonus EDU credits.
    /// @param diamondHands whether the users are a diamond hand.
    event InitialCreditsSet(address[] users, uint256[] unclaimed, uint256[] bonus, bool[] diamondHands);

    /// @notice Emitted when credits are spent.
    /// @param spender the spender of the credits.
    /// @param user the user whose credits are spent.
    /// @param bonusSpent the amount of bonus credits spent.
    /// @param unclaimedSpent the amount of unclaimed credits spent.
    /// @param depositedSpent the amount of deposited credits spent.
    event CreditsSpent(address spender, address user, uint256 bonusSpent, uint256 unclaimedSpent, uint256 depositedSpent);

    /// @notice Thrown when the phase being set is invalid.
    /// @param phase the invalid phase.
    error SettingInvalidPhase(uint256 phase);

    /// @notice Thrown when an action is performed during the wrong phase.
    /// @param expectedPhase the expected phase.
    /// @param actualPhase the actual phase.
    error OnlyDuringPhase(uint256 expectedPhase, uint256 actualPhase);

    /// @notice Thrown when setting the initial credits for a zero address user.
    error ZeroAddressUser();

    /// @notice Thrown when setting the initial credits for a user with zero unclaimed credits.
    /// @param user the user whose credits are set.
    error ZeroValueUnclaimedCredits(address user);

    /// @notice Thrown when setting the initial credits for a user whose credits have already been set.
    /// @param user the user whose credits are set.
    error UserCreditsAlreadySet(address user);

    /// @notice Thrown when trying to spend zero credits.
    /// @param spender the spender of the credits.
    /// @param user the user whose credits are spent.
    error ZeroSpendAmount(address spender, address user);

    /// @notice Thrown when trying to spend more credits than the user has.
    /// @param spender the spender of the credits.
    /// @param user the user whose credits are spent.
    /// @param amount the amount of credits to spend.
    error InsufficientCredits(address spender, address user, uint256 amount);

    /// @notice Thrown when trying to recover more EDU tokens than accidentally sent to this contract.
    error UnrecoverableEDU(uint256 recoverable, uint256 recovering);

    /// @dev Emits a {PhaseSet} to INIT_PHASE event.
    constructor(
        IERC20 eduToken,
        address payable payoutWallet,
        address unclaimedEDUHolder,
        IForwarderRegistry forwarderRegistry
    ) PayoutWallet(payoutWallet) ContractOwnership(msg.sender) ForwarderRegistryContext(forwarderRegistry) {
        EDU_TOKEN = eduToken;
        UNCLAIMED_EDU_HOLDER = unclaimedEDUHolder;
        emit PhaseSet(INIT_PHASE);
    }

    /// @notice Sets the current phase.
    /// @dev Reverts with {SettingInvalidPhase} if `phase` is greater than `WITHDRAW_PHASE`.
    /// @dev Reverts with {NotContractOwner} if the sender is not the contract owner.
    /// @dev Emits a {PhaseSet} event.
    /// @param phase the phase to set.
    function setPhase(uint256 phase) external {
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());
        if (phase > WITHDRAW_PHASE) revert SettingInvalidPhase(phase);
        currentPhase = phase;
        emit PhaseSet(DEPOSIT_PHASE);
    }

    /// @notice Sets the unclaimed and bonus EDU credits for a list of users.
    /// @dev Reverts with {InconsistentArrayLengths} if `users`, `unclaimed` and `bonus` have different lengths.
    /// @dev Reverts with {OnlyDuringPhase} if the current phase is not the init phase.
    /// @dev Reverts with {NotContractOwner} if the sender is not the contract owner.
    /// @dev Reverts with {ZeroAddressUser} if one of `users` is the zero address.
    /// @dev Reverts with {UserCreditsAlreadySet} if one of `users` credits have already been set.
    /// @dev Emits a {InitialCreditsSet} event.
    /// @param users the users whose credits are set.
    /// @param unclaimedCredits the unclaimed EDU credits.
    /// @param bonusCredits the bonus EDU credits.
    /// @param diamondHands whether the users are a diamond hand.
    function setInitialCredits(
        address[] calldata users,
        uint256[] calldata unclaimedCredits,
        uint256[] calldata bonusCredits,
        bool[] calldata diamondHands
    ) external {
        uint256 length = users.length;
        if (length != unclaimedCredits.length || length != bonusCredits.length || length != diamondHands.length) revert InconsistentArrayLengths();
        if (currentPhase != INIT_PHASE) revert OnlyDuringPhase(INIT_PHASE, currentPhase);
        ContractOwnershipStorage.layout().enforceIsContractOwner(_msgSender());
        for (uint256 i; i != length; ++i) {
            address user = users[i];
            if (user == address(0)) revert ZeroAddressUser();
            uint256 unclaimed = unclaimedCredits[i];
            if (unclaimed == 0) revert ZeroValueUnclaimedCredits(user);
            UserCredits storage credits = userCredits[user];
            if (credits.unclaimed != 0) revert UserCreditsAlreadySet(user);
            uint256 bonus = bonusCredits[i];
            credits.unclaimed = unclaimed;
            credits.bonus = bonus;
            credits.diamondHand = diamondHands[i];
            totalCredits += unclaimed + bonus;
        }
        emit InitialCreditsSet(users, unclaimedCredits, bonusCredits, diamondHands);
    }

    /// @inheritdoc IERC20Receiver
    /// @notice Receives EDU tokens deposits from users during the deposit phase and adds them to the deposited amount.
    /// @dev Reverts with {OnlyDuringPhase} if the current phase is not the deposit phase.
    function onERC20Received(address, address from, uint256 value, bytes calldata) external returns (bytes4 magicValue) {
        if (currentPhase != DEPOSIT_PHASE) revert OnlyDuringPhase(DEPOSIT_PHASE, currentPhase);
        UserCredits storage credits = userCredits[from];
        credits.deposited += value;
        totalDeposited += value;
        totalCredits += value;
        return ERC20Storage.ERC20_RECEIVED;
    }

    /// @notice Spends EDU tokens from the user's balance by a spender account.
    /// @notice The credits are used in this order of priority: 1. bonus 2. unclaimed 3. deposited.
    /// @dev Reverts with {ZeroSpendAmount} if `amount` is zero.
    /// @dev Reverts with {OnlyDuringPhase} if the current phase is not the sale phase.
    /// @dev Reverts with {NotRoleHolder} if the sender is not a spender.
    /// @dev Reverts with {InsufficientEDU} if the user's total unclaimed+bonus+deposited credits is insufficient.
    /// @dev Emits a {EDUSpent} event.
    /// @param user the user whose EDU tokens are spent.
    /// @param amount the amount of EDU tokens to spend.
    function spend(address user, uint256 amount) external {
        address spender = _msgSender();
        if (amount == 0) revert ZeroSpendAmount(spender, user);
        if (currentPhase != SALE_PHASE) revert OnlyDuringPhase(SALE_PHASE, currentPhase);
        AccessControlStorage.layout().enforceHasRole(SPENDER_ROLE, spender);
        UserCredits storage credits = userCredits[user];

        uint256 bonusSpent;
        uint256 bonus = credits.bonus;
        if (bonus != 0) {
            if (bonus >= amount) {
                credits.bonus -= amount;
                emit CreditsSpent(spender, user, amount, 0, 0);
                return;
            } else {
                credits.bonus = 0;
                amount -= bonus;
                bonusSpent = bonus;
            }
        }

        uint256 unclaimedSpent;
        uint256 unclaimed = credits.unclaimed;
        if (unclaimed != 0) {
            if (unclaimed >= amount) {
                credits.unclaimed -= amount;
                emit CreditsSpent(spender, user, bonusSpent, amount, 0);
                return;
            } else {
                credits.unclaimed = 0;
                amount -= unclaimed;
                unclaimedSpent = unclaimed;
            }
        }

        uint256 deposited = credits.deposited;
        if (deposited < amount) revert InsufficientCredits(spender, user, amount);

        credits.deposited -= amount;
        totalDeposited -= amount;
        EDU_TOKEN.transfer(PayoutWalletStorage.layout().payoutWallet(), amount);
        emit CreditsSpent(spender, user, bonusSpent, unclaimedSpent, amount);
    }

    /// @notice Withdraws all the remaining unclaimed and deposited EDU credits.
    /// @dev Reverts with {OnlyDuringPhase} if the current phase is not the withdraw phase.
    function withdraw() external {
        if (currentPhase != WITHDRAW_PHASE) revert OnlyDuringPhase(WITHDRAW_PHASE, currentPhase);
        address user = _msgSender();
        UserCredits storage credits = userCredits[_msgSender()];
        uint256 unclaimed = credits.unclaimed;
        if (unclaimed != 0) {
            credits.unclaimed = 0;
            EDU_TOKEN.transferFrom(UNCLAIMED_EDU_HOLDER, user, unclaimed);
        }

        uint256 deposited = credits.deposited;
        if (deposited != 0) {
            credits.deposited = 0;
            totalDeposited -= deposited;
            EDU_TOKEN.transfer(user, deposited);
        }
    }

    /// @inheritdoc TokenRecoveryBase
    /// @notice EDU tokens deposited to this contract through onERC20Received cannot be extracted via this function.
    /// @dev Reverts with {UnrecoverableEDU} if trying to extract EDU in larger quantities than accidentally sent to this contract.
    function recoverERC20s(address[] calldata accounts, IERC20[] calldata tokens, uint256[] calldata amounts) public virtual override {
        uint256 recoverableEDUAmount = EDU_TOKEN.balanceOf(address(this)) - totalDeposited;
        uint256 eduAmount;
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == EDU_TOKEN) {
                eduAmount += amounts[i];
            }
        }
        if (eduAmount > recoverableEDUAmount) {
            revert UnrecoverableEDU(recoverableEDUAmount, eduAmount);
        }
        super.recoverERC20s(accounts, tokens, amounts);
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
