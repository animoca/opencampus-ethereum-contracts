# Changelog

## 1.6.1
- Remediation based on internal audit AB-SC-SOL-01

## 1.6.0
- Added EDULandRewardsKYCController contract and related test cases. 

## 1.5.1

- Updated .nvmrc to use the latest Node.js LTS version (lts/jod)
- Updated GitHub Actions workflow to use Node.js v22.14, and v4 for actions/checkout and actions/setup-node
- Upgraded Hardhat and related package versions for compatibility with Node.js 22
- Fixed async handling issues in test cases for OpenCampusCertificateNFTMinter, PublisherNFTSale, and PublisherNFTSale contracts

## 1.5.0

- Added EDULandPriceHelperV2 contract and related test cases. 

## 1.4.7

- Further updated the function doc for EDULandRewards._claimRewards().

## 1.4.6

- Fixed the outdated function doc for EDULandRewards._claimRewards()

## 1.4.5

- Revert the EDULandRewards._claimRewards() method if the current NFT owner does not pass KYC check.

## 1.4.4

- Removed trailing space in EDULandRewards.test.js.

## 1.4.3

- Added the missing test cases for EDULandRewards._claimRewards() where some batchNumber is 0.
- Updated the MockReferee contract to achieve the above test case.
- Further removed duplicated _msgSender() call in EDULand.

## 1.4.2

- Remediations based on internal audit AB-SC-SOL-01 to AB-SC-SOL-09
- Expose EDULandRewards.isKycWallet() public view function
- Skip but not revert if the recipient of a claimable batch in EDULandRewards hasn't been registered as a KYC wallet.

## 1.4.1

- Revert with TokenAlreadyRented error in EDULandRental.estimateRentalFee() view function if expired tokens are not collected

## 1.4.0

- Added EDULand, EDULandRental, EDULandPriceHelper, EDULandRewards contracts.
- Added "@gelatonetwork/node-sale-rewards" dependency
- Upgraded node version of the github workflow version to 20.18

## 1.3.2

- Bump package version for merging into main.

## 1.3.1

- Updates per remediations called out in internal audit report AB-SC-SOL-01 to AB-SC-SOL-15 and AB-SC-TST-1

## 1.3.0

- Added Verifiable Credentials smart contracts and related test cases

## 1.2.1

Updated OCPointMerkleClaim smart contract and related test cases based on audit report issued on 2024/10/28

- AB-SC-SC-01: Incorrect variable OCPoint casing
- AB-SC-SC-02: Comments do not correctly describe the contract’s behavior

## 1.2.0

- Added OCPointMerkleClaim smart contract and related test cases.
- Add "@animoca/anichess-ethereum-contracts-2.2.3" as devDependencies

## 1.1.0

Added escrow reward related smart contracts and related test cases.

- PublisherNFTEscrow
- GenesisTokenEscrow
- EDuCoinMerkleClaim

## 1.0.0

Initial release.
