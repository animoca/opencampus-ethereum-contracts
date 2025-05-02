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
    /// @param account The account address.
    /// @param vcId The token ID of the VC.
    error KycWalletAlreadySet(address account, uint256 vcId);

    /// @notice Thrown when the VC token ID is not set for the account when removing KYC accounts.
    /// @param account The account address.
    error KycWalletNotSet(address account);

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

    /// @notice Adds KYC wallets to the EDULandRewards contract by verifying the VC token IDs.
    /// @dev Reverts with {KycWalletAlreadySet} if the VC token ID already exists for the account.
    /// @dev Reverts with {InvalidIssuerDid} if the VC issuer DID hash does not match.
    /// @dev Reverts with {RevokedVc} if the VC is revoked.
    /// @dev Emits {KycWalletsAdded} with the list of wallet addresses added.
    /// @param vcIds The list of VC token IDs.
    function addKycWallets(uint256[] calldata vcIds) external {
        uint256 length = vcIds.length;
        address[] memory accounts = new address[](length);

        bytes32 hashedIssuerDid = VC_ISSUER_DID_HASH;
        IRevocationRegistry revocationRegistry = KYC_CERTIFICATE_NFT.revocationRegistry();

        for (uint256 i = 0; i < length; i++) {
            uint256 vcId = vcIds[i];
            address owner = KYC_CERTIFICATE_NFT.ownerOf(vcId);
            if (vcIdPerAccount[owner] != 0) {
                revert KycWalletAlreadySet(owner, vcId);
            }

            (, , , , , string memory issuerDid, ) = KYC_CERTIFICATE_NFT.vcData(vcId);
            bytes32 vcHashedIssuerDid = keccak256(bytes(issuerDid));
            if (hashedIssuerDid != vcHashedIssuerDid) {
                revert InvalidIssuerDid(vcId);
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

    /// @notice Removes KYC wallets from the EDULandRewards contract.
    /// @dev Reverts with {KycWalletNotSet} if the VC token ID is not set for the account.
    /// @dev Reverts with {VcNotRevoked} if the VC is not revoked.
    /// @dev Emits {KycWalletsRemoved} with the list of wallet addresses removed.
    /// @param accounts The list of wallet addresses.
    function removeKycWallets(address[] calldata accounts) external {
        IRevocationRegistry revocationRegistry = KYC_CERTIFICATE_NFT.revocationRegistry();

        for (uint256 i; i < accounts.length; i++) {
            address account = accounts[i];
            uint256 vcId = vcIdPerAccount[account];
            if (vcId == 0) {
                revert KycWalletNotSet(account);
            }

            (, , , , , string memory issuerDid, ) = KYC_CERTIFICATE_NFT.vcData(vcId);
            bytes32 vcHashedIssuerDid = keccak256(bytes(issuerDid));
            bool isRevoked = revocationRegistry.isRevoked(vcHashedIssuerDid, vcId);
            if (!isRevoked) {
                revert VcNotRevoked(vcId);
            }
            delete vcIdPerAccount[account];
        }

        EDU_LAND_REWARDS.removeKycWallets(accounts);
        emit KycWalletsRemoved(accounts);
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
