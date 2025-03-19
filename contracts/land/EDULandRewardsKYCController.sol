// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {RewardsKYC} from "@gelatonetwork/node-sale-rewards/contracts/RewardsKYC.sol";
import {AccessControl} from "@animoca/ethereum-contracts/contracts/access/AccessControl.sol";
import {AccessControlStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/AccessControlStorage.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {ContractOwnershipStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/ContractOwnershipStorage.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {ForwarderRegistryContext} from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";
import {IRevocationRegistry} from "../vc/interfaces/IRevocationRegistry.sol";
import {IIssuersDIDRegistry} from "../vc/interfaces/IIssuersDIDRegistry.sol";
import {OpenCampusCertificateNFTv1} from "../vc/OpenCampusCertificateNFTv1.sol";

/// @title EDULandRewardsKYCController
/// @notice A contract for managing KYC accounts in EDULandRewards, utilizing OpenCampusCertificateNFTv1 (VC) as proof of KYC approval.
contract EDULandRewardsKYCController is AccessControl, ForwarderRegistryContext {
    using AccessControlStorage for AccessControlStorage.Layout;
    using ContractOwnershipStorage for ContractOwnershipStorage.Layout;

    /// @notice The role identifier for the operator role.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice An reference to the EDULandRewards contract.
    RewardsKYC public immutable EDU_LAND_REWARDS;

    /// @notice An reference to the OpenCampusCertificateNFTv1 contract.
    OpenCampusCertificateNFTv1 public immutable VC_NFT_V1;

    /// @notice An reference to an IIssuersDIDRegistry instance.
    IIssuersDIDRegistry public immutable VC_ISSUERS_DID_REGISTRY;

    /// @notice The VC issuer address.
    address public vcIssuer;

    /// @notice A mapping of the VC token ID per account.
    mapping(address account => uint256 vcId) public vcIdPerAccount;

    /// @notice Emitted when the VC issuer is set.
    /// @param vcIssuer The VC issuer address.
    event VcIssuerSet(address vcIssuer);

    /// @notice Emitted when KYC accounts are added.
    /// @param accounts A list of wallet addresses added.
    event KycWalletsAdded(address[] accounts);

    /// @notice Emitted when KYC accounts are removed.
    /// @param accounts A list of wallet addresses removed.
    event KycWalletsRemoved(address[] accounts);

    /// @notice Thrown when the EDULandRewards address is invalid.
    error InvalidEduLandRewardsAddress();

    /// @notice Thrown when the OpenCampusCertificateNFTv1 address is invalid.
    error InvalidCertificateNFTv1Address();

    /// @notice Thrown when the VC issuer is invalid.
    /// @param issuerDid The issuer DID hash.
    error InvalidVcIssuerDid(bytes32 issuerDid);

    /// @notice Thrown when the VC is revoked when adding KYC accounts.
    /// @param vcId The token ID of the VC.
    error RevokedVc(uint256 vcId);

    /// @notice Thrown when the VC is not revoked when removing KYC accounts.
    /// @param vcId The token ID of the VC.
    error VcNotRevoked(uint256 vcId);

    /// @notice Thrown when the VC token ID already exists for the account when adding KYC accounts.
    /// @param account The account address.
    /// @param vcId The token ID of the VC.
    error KycWalletAlreadySet(address account, uint256 vcId);

    /// @notice Thrown when the VC token ID is not set for the account when removing KYC accounts.
    /// @param account The account address.
    error KycWalletNotSet(address account);

    /// @notice Constructor.
    /// @dev Reverts with {InvalidEduLandRewardsAddress} if the EDULandRewards address is invalid.
    /// @dev Reverts with {InvalidCertificateNFTv1Address} if the OpenCampusCertificateNFTv1 address is invalid.
    /// @dev Emits {VcIssuerSet} with the VC issuer address.
    /// @param eduLandRewardsAddress The address of the EDULandRewards contract.
    /// @param certificateNFTv1Address The address of the OpenCampusCertificateNFTv1 contract.
    /// @param vcIssuer_ The VC issuer address.
    /// @param forwarderRegistry The address of the ForwarderRegistry contract.
    constructor(
        address eduLandRewardsAddress,
        address certificateNFTv1Address,
        address vcIssuer_,
        IForwarderRegistry forwarderRegistry
    ) ContractOwnership(msg.sender) ForwarderRegistryContext(forwarderRegistry) {
        if (eduLandRewardsAddress == address(0)) {
            revert InvalidEduLandRewardsAddress();
        }
        EDU_LAND_REWARDS = RewardsKYC(eduLandRewardsAddress);

        if (certificateNFTv1Address == address(0)) {
            revert InvalidCertificateNFTv1Address();
        }
        VC_NFT_V1 = OpenCampusCertificateNFTv1(certificateNFTv1Address);
        VC_ISSUERS_DID_REGISTRY = VC_NFT_V1.DID_REGISTRY();

        vcIssuer = vcIssuer_;
        emit VcIssuerSet(vcIssuer_);
    }

    /// @notice Sets the VC issuer address.
    /// @dev Reverts with {NotRoleHolder} if the sender does not have the operator role.
    /// @param vcIssuer_ The VC issuer address.
    function setVcIssuer(address vcIssuer_) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, _msgSender());
        vcIssuer = vcIssuer_;
        emit VcIssuerSet(vcIssuer_);
    }

    /// @notice Adds KYC wallets.
    /// @dev Reverts with {KycWalletAlreadySet} if the VC token ID already exists for the account.
    /// @dev Reverts with {InvalidVcIssuerDid} if the VC issuer is invalid.
    /// @dev Reverts with {RevokedVc} if the VC is revoked.
    /// @dev Emits {KycWalletsAdded} with the list of wallet addresses added.
    /// @param vcIds The list of VC token IDs.
    function addKycWallets(uint256[] calldata vcIds) external {
        uint256 length = vcIds.length;
        address[] memory accounts = new address[](length);

        address issuer = vcIssuer;
        IRevocationRegistry revocationRegistry = VC_NFT_V1.revocationRegistry();

        for (uint256 i = 0; i < length; i++) {
            uint256 vcId = vcIds[i];
            address owner = VC_NFT_V1.ownerOf(vcId);
            if (vcIdPerAccount[owner] != 0) {
                revert KycWalletAlreadySet(owner, vcId);
            }

            (, , , , , string memory issuerDid, ) = VC_NFT_V1.vcData(vcId);
            bytes32 vcHashedIssuerDid = keccak256(bytes(issuerDid));
            if (!VC_ISSUERS_DID_REGISTRY.isIssuerAllowed(issuerDid, issuer)) {
                revert InvalidVcIssuerDid(vcHashedIssuerDid);
            }

            bool isRevoked = revocationRegistry.isRevoked(vcHashedIssuerDid, vcId);
            if (isRevoked) {
                revert RevokedVc(vcId);
            }

            accounts[i] = owner;
            vcIdPerAccount[owner] = vcId;
        }

        EDU_LAND_REWARDS.addKycWallets(accounts);
        emit KycWalletsAdded(accounts);
    }

    /// @notice Removes KYC wallets.
    /// @dev Reverts with {KycWalletNotSet} if the VC token ID is not set for the account.
    /// @dev Reverts with {VcNotRevoked} if the VC is not revoked.
    /// @dev Emits {KycWalletsRemoved} with the list of wallet addresses removed.
    /// @param accounts The list of wallet addresses.
    function removeKycWallets(address[] calldata accounts) external {
        address issuer = vcIssuer;
        IRevocationRegistry revocationRegistry = VC_NFT_V1.revocationRegistry();

        for (uint256 i; i < accounts.length; i++) {
            address account = accounts[i];
            uint256 vcId = vcIdPerAccount[account];
            if (vcId == 0) {
                revert KycWalletNotSet(account);
            }

            (, , , , , string memory issuerDid, ) = VC_NFT_V1.vcData(vcId);
            bytes32 vcHashedIssuerDid = keccak256(bytes(issuerDid));
            bool isIssuerAllowed = VC_ISSUERS_DID_REGISTRY.isIssuerAllowed(issuerDid, issuer);
            if (isIssuerAllowed) {
                bool isRevoked = revocationRegistry.isRevoked(vcHashedIssuerDid, vcId);
                if (!isRevoked) {
                    revert VcNotRevoked(vcId);
                }
            }
            delete vcIdPerAccount[account];
        }

        EDU_LAND_REWARDS.removeKycWallets(accounts);
        emit KycWalletsRemoved(accounts);
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
