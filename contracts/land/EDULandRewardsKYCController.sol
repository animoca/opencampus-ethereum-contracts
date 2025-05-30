// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {RewardsKYC} from "@gelatonetwork/node-sale-rewards/contracts/RewardsKYC.sol";
import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {ForwarderRegistryContextBase} from "@animoca/ethereum-contracts/contracts/metatx/base/ForwarderRegistryContextBase.sol";
import {ForwarderRegistryContext} from "@animoca/ethereum-contracts/contracts/metatx/ForwarderRegistryContext.sol";
import {IRevocationRegistry} from "../vc/interfaces/IRevocationRegistry.sol";
import {OpenCampusCertificateNFTv1} from "../vc/OpenCampusCertificateNFTv1.sol";

/// @title EDULandRewardsKYCController
/// @notice A contract for managing KYC accounts in EDULandRewards, utilizing OpenCampusCertificateNFTv1 (VC) as proof of KYC approval.
contract EDULandRewardsKYCController is ForwarderRegistryContext {
    /// @notice An reference to the EDULandRewards contract.
    RewardsKYC public immutable EDU_LAND_REWARDS;

    /// @notice An reference to the OpenCampusCertificateNFTv1 contract.
    OpenCampusCertificateNFTv1 public immutable KYC_CERTIFICATE_NFT;

    /// @notice The VC issuer DID hash.
    bytes32 public immutable VC_ISSUER_DID_HASH;

    /// @notice A mapping of the VC token ID per account.
    mapping(address account => uint256 vcId) public vcIdPerAccount;

    /// @notice Emitted when KYC accounts are added.
    /// @param accounts A list of wallet addresses added.
    event KycWalletsAdded(address[] accounts);

    /// @notice Emitted when KYC accounts are removed.
    /// @param accounts A list of wallet addresses removed.
    event KycWalletsRemoved(address[] accounts);

    /// @notice Thrown when the EDULandRewards address is invalid.
    error InvalidEduLandRewardsAddress();

    /// @notice Thrown when the OpenCampusCertificateNFTv1 address is invalid.
    error InvalidKycCertificateNFTAddress();

    /// @notice Thrown when the VC issuer DID hash does not match.
    /// @param vcId The token ID of the VC.
    error InvalidIssuerDid(uint256 vcId);

    /// @notice Thrown when the VC is revoked when adding KYC accounts.
    /// @param vcId The token ID of the VC.
    error RevokedVc(uint256 vcId);

    /// @notice Thrown when the VC is not revoked when removing KYC accounts.
    /// @param vcId The token ID of the VC.
    error VcNotRevoked(uint256 vcId);

    /// @notice Thrown when the VC token ID already exists for the account when adding KYC accounts.
    error KycWalletAlreadySet();

    /// @notice Thrown when there is no valid wallet to be added into the KYC list.
    error NoWalletToBeAdded();

    /// @notice Thrown when there is no valid wallet to be removed from the KYC list.
    error NoWalletToBeRemoved();

    /// @notice Constructor.
    /// @dev Reverts with {InvalidEduLandRewardsAddress} if the EDULandRewards address is zero.
    /// @dev Reverts with {InvalidKycCertificateNFTAddress} if the OpenCampusCertificateNFTv1 address is zero.
    /// @param eduLandRewardsAddress The address of the EDULandRewards contract.
    /// @param kycCertificateNftAddress The address of the OpenCampusCertificateNFTv1 contract for KYC.
    /// @param vcIssuerDid The VC issuer DID.
    /// @param forwarderRegistry The address of the ForwarderRegistry contract.
    constructor(
        address eduLandRewardsAddress,
        address kycCertificateNftAddress,
        string memory vcIssuerDid,
        IForwarderRegistry forwarderRegistry
    ) ForwarderRegistryContext(forwarderRegistry) {
        if (eduLandRewardsAddress == address(0)) revert InvalidEduLandRewardsAddress();
        if (kycCertificateNftAddress == address(0)) revert InvalidKycCertificateNFTAddress();

        EDU_LAND_REWARDS = RewardsKYC(eduLandRewardsAddress);
        KYC_CERTIFICATE_NFT = OpenCampusCertificateNFTv1(kycCertificateNftAddress);
        VC_ISSUER_DID_HASH = keccak256(bytes(vcIssuerDid));
    }

    /// @notice Adds a KYC wallet to the EDULandRewards contract by verifying the VC token ID.
    /// @dev Reverts with {KycWalletAlreadySet} if the account already being added by this contract.
    /// @dev Reverts with {InvalidIssuerDid} if the VC issuer DID hash does not match.
    /// @dev Reverts with {RevokedVc} if the VC is revoked.
    /// @dev Emits {KycWalletsAdded} with the wallet address being successfully added.
    /// @param vcId The VC token ID to be verified.
    function addKycWallet(uint256 vcId) external {
        address owner = KYC_CERTIFICATE_NFT.ownerOf(vcId);
        if (vcIdPerAccount[owner] != 0) {
            revert KycWalletAlreadySet();
        }

        (, , , , , string memory issuerDid, ) = KYC_CERTIFICATE_NFT.vcData(vcId);
        bytes32 vcHashedIssuerDid = keccak256(bytes(issuerDid));
        if (VC_ISSUER_DID_HASH != vcHashedIssuerDid) {
            revert InvalidIssuerDid(vcId);
        }

        bool isRevoked = KYC_CERTIFICATE_NFT.revocationRegistry().isRevoked(vcHashedIssuerDid, vcId);
        if (isRevoked) {
            revert RevokedVc(vcId);
        }

        address[] memory accounts = new address[](1);
        accounts[0] = owner;

        vcIdPerAccount[owner] = vcId;
        EDU_LAND_REWARDS.addKycWallets(accounts);
        emit KycWalletsAdded(accounts);
    }

    /// @notice Adds KYC wallets to the EDULandRewards contract by verifying the VC token IDs.
    /// @dev Reverts with {InvalidIssuerDid} if the VC issuer DID hash does not match.
    /// @dev Reverts with {RevokedVc} if the VC is revoked.
    /// @dev Reverts with {NoWalletToBeAdded} if there is no valid wallet to be added into the KYC list.
    /// @dev Emits {KycWalletsAdded} with the list of wallet addresses being successfully added.
    /// @param vcIds The list of VC token IDs.
    function addKycWallets(uint256[] calldata vcIds) external {
        IRevocationRegistry revocationRegistry = KYC_CERTIFICATE_NFT.revocationRegistry();

        uint256 length = vcIds.length;
        address[] memory accounts = new address[](length);
        uint256 validCount = 0;

        for (uint256 i = 0; i < length; i++) {
            uint256 vcId = vcIds[i];
            address owner = KYC_CERTIFICATE_NFT.ownerOf(vcId);
            if (vcIdPerAccount[owner] != 0) {
                continue;
            }

            (, , , , , string memory issuerDid, ) = KYC_CERTIFICATE_NFT.vcData(vcId);
            bytes32 vcHashedIssuerDid = keccak256(bytes(issuerDid));
            if (VC_ISSUER_DID_HASH != vcHashedIssuerDid) {
                revert InvalidIssuerDid(vcId);
            }

            bool isRevoked = revocationRegistry.isRevoked(vcHashedIssuerDid, vcId);
            if (isRevoked) {
                revert RevokedVc(vcId);
            }
            vcIdPerAccount[owner] = vcId;

            accounts[validCount++] = owner;
        }

        if (validCount == 0) {
            revert NoWalletToBeAdded();
        }

        address[] memory validAccounts = new address[](validCount);
        for (uint256 i = 0; i < validCount; i++) {
            validAccounts[i] = accounts[i];
        }

        EDU_LAND_REWARDS.addKycWallets(validAccounts);
        emit KycWalletsAdded(validAccounts);
    }

    /// @notice Removes KYC wallets from the EDULandRewards contract.
    /// @dev Reverts with {VcNotRevoked} if the VC is not revoked.
    /// @dev Reverts with {NoWalletToBeRemoved} if there is no valid wallet to be removed from the KYC list.
    /// @dev Emits {KycWalletsRemoved} with the list of wallet addresses being successfully removed.
    /// @param accounts The list of wallet addresses.
    function removeKycWallets(address[] calldata accounts) external {
        IRevocationRegistry revocationRegistry = KYC_CERTIFICATE_NFT.revocationRegistry();

        uint256 length = accounts.length;
        address[] memory tempAccounts = new address[](length);
        uint256 validCount = 0;

        for (uint256 i; i < length; i++) {
            address account = accounts[i];
            uint256 vcId = vcIdPerAccount[account];
            if (vcId == 0) {
                continue;
            }

            (, , , , , string memory issuerDid, ) = KYC_CERTIFICATE_NFT.vcData(vcId);
            bytes32 vcHashedIssuerDid = keccak256(bytes(issuerDid));
            bool isRevoked = revocationRegistry.isRevoked(vcHashedIssuerDid, vcId);
            if (!isRevoked) {
                revert VcNotRevoked(vcId);
            }
            delete vcIdPerAccount[account];

            tempAccounts[validCount++] = account;
        }

        if (validCount == 0) {
            revert NoWalletToBeRemoved();
        }

        address[] memory validAccounts = new address[](validCount);
        for (uint256 i = 0; i < validCount; i++) {
            validAccounts[i] = tempAccounts[i];
        }
        EDU_LAND_REWARDS.removeKycWallets(validAccounts);
        emit KycWalletsRemoved(validAccounts);
    }

    /// @inheritdoc ForwarderRegistryContextBase
    function _msgSender() internal view virtual override(ForwarderRegistryContextBase) returns (address) {
        return ForwarderRegistryContextBase._msgSender();
    }

    /// @inheritdoc ForwarderRegistryContextBase
    function _msgData() internal view virtual override(ForwarderRegistryContextBase) returns (bytes calldata) {
        return ForwarderRegistryContextBase._msgData();
    }
}
