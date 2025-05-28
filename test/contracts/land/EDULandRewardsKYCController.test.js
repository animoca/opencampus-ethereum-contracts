/* eslint-disable max-len */
const {ethers} = require('hardhat');
const {expect} = require('chai');
const {parseEther, keccak256, toUtf8Bytes, ZeroAddress} = require('ethers');

const {deployContract, deployContractFromPath} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {deployTokenMetadataResolverWithBaseURI, getForwarderRegistryAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');

const {RevocationUtil} = require('../vc/utils/revocation');
const {setupOpenCampusCertificateNFTv1} = require('../setup');

describe('EDULandRewardsKYCController', function () {
  const REWARDS_CONTRACT_KYC_CONTROLLER_ROLE = keccak256(toUtf8Bytes('KYC_CONTROLLER_ROLE'));

  const VC_ISSUER = {
    did: 'did:key:zUC7KtygRhrsVGTMYx7LHWsg3dpPscW6VcBvps4KgoziJ2vYXW3er1vH9mCqM67q3Nqc3BXAy488po6zMu6yEXdWz4oRLD9rbP5abPAKFuZXqTiwyvrgDehsYtw1NjAhUSzcYiL',
    address: '0x58D027C315bAc47c60bD2491e2CBDce0977E3a37',
    name: 'test.edu',
    privateKey: '0x5a5c9a0954cc0a98584542c0fae233819133f8fc3ebafed632104bbe144ba2d7',
  };
  const VC_TOKEN_ID = '0x3E68D6D114FC48F393517777295C8D64';
  const VC_TOKEN_ID_2 = '0xE291B7D94A184CE4A59CB8F2E0527B8E';
  const getVcMetadata = (issuerDid = VC_ISSUER.did) => {
    const now = 1742256000000;
    return {
      schemaVersion: 1,
      achievementType: 3,
      awardedDate: now,
      validFrom: now,
      validUtil: now + 365 * 24 * 3600 * 1000,
      issuerDid,
      achievementId: 'achievement-123-xyz',
    };
  };

  let deployer, user, user2, user3, payoutWallet, other;
  before(async function () {
    [deployer, user, user2, user3, payoutWallet, other] = await ethers.getSigners();
  });

  const fixture = async function () {
    await setupOpenCampusCertificateNFTv1.call(this, deployer, user, payoutWallet);
    await this.didRegistry.addIssuer(VC_ISSUER.did, VC_ISSUER.address);
    this.vcRevocationUtil = new RevocationUtil(VC_ISSUER.privateKey, await this.revocationRegistry.getAddress());

    this.forwarderRegistryAddress = await getForwarderRegistryAddress();
    const metadataResolverAddress = await deployTokenMetadataResolverWithBaseURI();
    const landContract = await deployContract('EDULand', 'EDU Land', 'EDULand', metadataResolverAddress);
    const refereeImplementation = await deployContract('RefereeMock', landContract);
    const refereeContract = await ethers.getContractAt(
      'RefereeMock',
      await deployContractFromPath(
        'EIP173ProxyWithReceive',
        'node_modules/hardhat-deploy/extendedArtifacts',
        refereeImplementation,
        deployer.address,
        '0x'
      )
    );
    this.nodeRewardsContract = await deployContract(
      'EDULandRewards',
      20n * 60n, // 20 minutes max reward time window
      refereeContract,
      landContract,
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // reward token
      parseEther('0.01'), // reward per second
      deployer
    );

    this.contract = await deployContract(
      'EDULandRewardsKYCControllerMock',
      this.nodeRewardsContract,
      this.ocNFT,
      VC_ISSUER.did,
      this.forwarderRegistryAddress
    );
    await this.nodeRewardsContract.connect(deployer).grantRole(REWARDS_CONTRACT_KYC_CONTROLLER_ROLE, this.contract);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  context(
    'constructor(address eduLandRewardsAddress, address certificateNFTv1Address, address vcIssuerAddress, IForwarderRegistry forwarderRegistry)',
    function () {
      it('reverts if eduLandRewardsAddress is a zero address', async function () {
        await expect(
          deployContract('EDULandRewardsKYCController', ZeroAddress, this.ocNFT, VC_ISSUER.did, this.forwarderRegistryAddress)
        ).to.be.revertedWithCustomError(this.contract, 'InvalidEduLandRewardsAddress');
      });

      it('reverts if certificateNFTv1Address is a zero address', async function () {
        await expect(
          deployContract('EDULandRewardsKYCController', this.nodeRewardsContract, ZeroAddress, VC_ISSUER.did, this.forwarderRegistryAddress)
        ).to.be.revertedWithCustomError(this.contract, 'InvalidKycCertificateNFTAddress');
      });
    }
  );

  context('addKycWallet(uint256)', function () {
    it('reverts if the Vc doesn’t exist', async function () {
      await expect(this.contract.addKycWallet(VC_TOKEN_ID)).to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonExistingToken').withArgs(VC_TOKEN_ID);
    });

    context("when VC issuer DID doesn't match", function () {
      beforeEach(async function () {
        await this.ocNFT.mint(user.address, VC_TOKEN_ID, getVcMetadata());
        await this.ocNFT.mint(user2.address, VC_TOKEN_ID_2, getVcMetadata('did:key:nonExists'));
      });

      it("reverts if the issuer DID doesn't match", async function () {
        await expect(this.contract.addKycWallet(VC_TOKEN_ID_2))
          .to.be.revertedWithCustomError(this.contract, 'InvalidIssuerDid')
          .withArgs(VC_TOKEN_ID_2);
      });
    });

    context('when attempting to add a wallet that is already set', function () {
      beforeEach(async function () {
        const metaData = getVcMetadata();
        await this.ocNFT.mint(user.address, VC_TOKEN_ID, metaData);
        await this.ocNFT.mint(user.address, VC_TOKEN_ID_2, metaData);
        await this.contract.addKycWallet(VC_TOKEN_ID);
      });

      it('reverts if the wallet has been added by this contract', async function () {
        await expect(this.contract.addKycWallet(VC_TOKEN_ID)).to.be.revertedWithCustomError(this.contract, 'KycWalletAlreadySet');
      });
    });

    context('when Vc is revoked', function () {
      beforeEach(async function () {
        const metaData = getVcMetadata();
        await this.ocNFT.mint(user.address, VC_TOKEN_ID, metaData);

        const {hashedDid, signature} = await this.vcRevocationUtil.makePayloadAndSignature(VC_ISSUER.did, VC_TOKEN_ID);
        await this.revocationRegistry.revokeVC(hashedDid, VC_TOKEN_ID, signature);

        await this.ocNFT.mint(user2.address, VC_TOKEN_ID_2, metaData);
      });

      it('reverts if the Vc is revoked', async function () {
        await expect(this.contract.addKycWallet(VC_TOKEN_ID)).to.be.revertedWithCustomError(this.contract, 'RevokedVc').withArgs(VC_TOKEN_ID);
      });
    });

    context('when successful', function () {
      beforeEach(async function () {
        const metaData = getVcMetadata();
        await this.ocNFT.mint(user.address, VC_TOKEN_ID, metaData);
        await this.ocNFT.mint(user2.address, VC_TOKEN_ID_2, metaData);
      });

      it('successfully adds a kyc wallet', async function () {
        await expect(this.contract.addKycWallet(VC_TOKEN_ID)).to.emit(this.contract, 'KycWalletsAdded').withArgs([user.address]);
        expect(await this.contract.vcIdPerAccount(user.address)).to.equal(VC_TOKEN_ID);
        expect(await this.nodeRewardsContract.isKycWallet(user.address)).to.be.true;
      });
    });
  });

  context('addKycWallets(uint256[])', function () {
    it('reverts if the Vc doesn’t exist', async function () {
      await expect(this.contract.addKycWallets([VC_TOKEN_ID]))
        .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonExistingToken')
        .withArgs(VC_TOKEN_ID);
    });

    context("when VC issuer DID doesn't match", function () {
      beforeEach(async function () {
        await this.ocNFT.mint(user.address, VC_TOKEN_ID, getVcMetadata());
        await this.ocNFT.mint(user2.address, VC_TOKEN_ID_2, getVcMetadata('did:key:nonExists'));
      });

      it("reverts if the issuer DID doesn't match", async function () {
        await expect(this.contract.addKycWallets([VC_TOKEN_ID_2]))
          .to.be.revertedWithCustomError(this.contract, 'InvalidIssuerDid')
          .withArgs(VC_TOKEN_ID_2);
      });

      it('reverts if one of the VCs issuer DID does not match', async function () {
        await expect(this.contract.addKycWallets([VC_TOKEN_ID, VC_TOKEN_ID_2]))
          .to.be.revertedWithCustomError(this.contract, 'InvalidIssuerDid')
          .withArgs(VC_TOKEN_ID_2);
      });
    });

    context('when attempting to add a wallet that is already set', function () {
      beforeEach(async function () {
        const metaData = getVcMetadata();
        await this.ocNFT.mint(user.address, VC_TOKEN_ID, metaData);
        await this.ocNFT.mint(user.address, VC_TOKEN_ID_2, metaData);
        await this.contract.addKycWallets([VC_TOKEN_ID]);
      });

      it('does not emit event if the providing Vc id is set', async function () {
        await expect(this.contract.addKycWallets([VC_TOKEN_ID])).to.not.emit(this.contract, 'KycWalletsAdded');
      });
    });

    context('when Vc is revoked', function () {
      beforeEach(async function () {
        const metaData = getVcMetadata();
        await this.ocNFT.mint(user.address, VC_TOKEN_ID, metaData);

        const {hashedDid, signature} = await this.vcRevocationUtil.makePayloadAndSignature(VC_ISSUER.did, VC_TOKEN_ID);
        await this.revocationRegistry.revokeVC(hashedDid, VC_TOKEN_ID, signature);

        await this.ocNFT.mint(user2.address, VC_TOKEN_ID_2, metaData);
      });

      it('reverts if the Vc is revoked', async function () {
        await expect(this.contract.addKycWallets([VC_TOKEN_ID]))
          .to.be.revertedWithCustomError(this.contract, 'RevokedVc')
          .withArgs(VC_TOKEN_ID);
      });

      it('reverts if one of the VCs is revoked', async function () {
        await expect(this.contract.addKycWallets([VC_TOKEN_ID, VC_TOKEN_ID_2]))
          .to.be.revertedWithCustomError(this.contract, 'RevokedVc')
          .withArgs(VC_TOKEN_ID);
      });
    });

    context('when successful', function () {
      const USER1_ANOTHER_VC_ID = '0x1A3C37937EFB40629EE4922FE6D510CD';
      beforeEach(async function () {
        const metaData = getVcMetadata();
        await this.ocNFT.mint(user.address, VC_TOKEN_ID, metaData);
        await this.ocNFT.mint(user.address, USER1_ANOTHER_VC_ID, metaData);

        await this.ocNFT.mint(user2.address, VC_TOKEN_ID_2, metaData);
      });

      it('successfully adds a kyc wallet', async function () {
        await expect(this.contract.addKycWallets([VC_TOKEN_ID]))
          .to.emit(this.contract, 'KycWalletsAdded')
          .withArgs([user.address]);
        expect(await this.contract.vcIdPerAccount(user.address)).to.equal(VC_TOKEN_ID);
        expect(await this.nodeRewardsContract.isKycWallet(user.address)).to.be.true;
      });

      it('successfully adds multiple kyc wallets', async function () {
        await expect(this.contract.addKycWallets([VC_TOKEN_ID, VC_TOKEN_ID_2]))
          .to.emit(this.contract, 'KycWalletsAdded')
          .withArgs([user.address, user2.address]);

        expect(await this.contract.vcIdPerAccount(user.address)).to.equal(VC_TOKEN_ID);
        expect(await this.contract.vcIdPerAccount(user2.address)).to.equal(VC_TOKEN_ID_2);

        expect(await this.nodeRewardsContract.isKycWallet(user.address)).to.be.true;
        expect(await this.nodeRewardsContract.isKycWallet(user2.address)).to.be.true;
      });

      context('when one of the wallets is already set', function () {
        it('successfully adds one valid account and skips the duplicated Vc id', async function () {
          await expect(this.contract.addKycWallets([VC_TOKEN_ID, USER1_ANOTHER_VC_ID]))
            .to.emit(this.contract, 'KycWalletsAdded')
            .withArgs([user.address]);
          expect(await this.contract.vcIdPerAccount(user.address)).to.equal(VC_TOKEN_ID);
        });

        it('successfully adds multiple valid accounts and skips the Vc id for the same wallet', async function () {
          await expect(this.contract.addKycWallets([VC_TOKEN_ID, USER1_ANOTHER_VC_ID, VC_TOKEN_ID_2]))
            .to.emit(this.contract, 'KycWalletsAdded')
            .withArgs([user.address, user2.address]);

          expect(await this.contract.vcIdPerAccount(user.address)).to.equal(VC_TOKEN_ID);
          expect(await this.contract.vcIdPerAccount(user2.address)).to.equal(VC_TOKEN_ID_2);

          expect(await this.nodeRewardsContract.isKycWallet(user.address)).to.be.true;
          expect(await this.nodeRewardsContract.isKycWallet(user2.address)).to.be.true;
        });
      });
    });
  });

  context('removeKycWallets(address[])', function () {
    it('skips if the wallet is not set', async function () {
      await expect(this.contract.removeKycWallets([user.address])).to.not.emit(this.contract, 'KycWalletsRemoved');
    });

    context('when VC not revoked', function () {
      beforeEach(async function () {
        const metaData = getVcMetadata();
        await this.ocNFT.mint(user.address, VC_TOKEN_ID, metaData);
        await this.ocNFT.mint(user2.address, VC_TOKEN_ID_2, metaData);
        await this.contract.addKycWallets([VC_TOKEN_ID, VC_TOKEN_ID_2]);

        const {hashedDid, signature} = await this.vcRevocationUtil.makePayloadAndSignature(VC_ISSUER.did, VC_TOKEN_ID);
        await this.revocationRegistry.revokeVC(hashedDid, VC_TOKEN_ID, signature);
      });

      it('reverts if the VC is not revoked', async function () {
        await expect(this.contract.removeKycWallets([user2.address]))
          .to.be.revertedWithCustomError(this.contract, 'VcNotRevoked')
          .withArgs(VC_TOKEN_ID_2);
      });

      it('reverts if one of the VCs is not revoked', async function () {
        await expect(this.contract.removeKycWallets([user.address, user2.address]))
          .to.be.revertedWithCustomError(this.contract, 'VcNotRevoked')
          .withArgs(VC_TOKEN_ID_2);
      });
    });

    context('when successful', function () {
      beforeEach(async function () {
        const metaData = getVcMetadata();
        await this.ocNFT.mint(user.address, VC_TOKEN_ID, metaData);
        await this.ocNFT.mint(user2.address, VC_TOKEN_ID_2, metaData);
        await this.contract.addKycWallets([VC_TOKEN_ID, VC_TOKEN_ID_2]);
      });

      it('remove a kyc wallet if the VC is revoked', async function () {
        const {hashedDid, signature} = await this.vcRevocationUtil.makePayloadAndSignature(VC_ISSUER.did, VC_TOKEN_ID);
        await this.revocationRegistry.revokeVC(hashedDid, VC_TOKEN_ID, signature);

        await expect(this.contract.removeKycWallets([user.address]))
          .to.emit(this.contract, 'KycWalletsRemoved')
          .withArgs([user.address]);
        expect(await this.contract.vcIdPerAccount(user.address)).to.equal(0);
        expect(await this.nodeRewardsContract.isKycWallet(user.address)).to.be.false;
      });

      it('remove a kyc wallet if the VC is burnt', async function () {
        const {hashedDid, signature} = await this.vcRevocationUtil.makePayloadAndSignature(VC_ISSUER.did, VC_TOKEN_ID);
        await this.revocationRegistry.revokeVC(hashedDid, VC_TOKEN_ID, signature);
        await this.ocNFT.burn(VC_TOKEN_ID);

        await expect(this.contract.removeKycWallets([user.address]))
          .to.emit(this.contract, 'KycWalletsRemoved')
          .withArgs([user.address]);
        expect(await this.contract.vcIdPerAccount(user.address)).to.equal(0);
        expect(await this.nodeRewardsContract.isKycWallet(user.address)).to.be.false;
      });

      it('remove multiple kyc wallets', async function () {
        const {hashedDid, signature} = await this.vcRevocationUtil.makePayloadAndSignature(VC_ISSUER.did, [VC_TOKEN_ID, VC_TOKEN_ID_2]);
        await this.revocationRegistry.batchRevokeVCs(hashedDid, [VC_TOKEN_ID, VC_TOKEN_ID_2], signature);

        await expect(this.contract.removeKycWallets([user.address, user2.address]))
          .to.emit(this.contract, 'KycWalletsRemoved')
          .withArgs([user.address, user2.address]);
        expect(await this.contract.vcIdPerAccount(user.address)).to.equal(0);
        expect(await this.contract.vcIdPerAccount(user2.address)).to.equal(0);
        expect(await this.nodeRewardsContract.isKycWallet(user.address)).to.be.false;
        expect(await this.nodeRewardsContract.isKycWallet(user2.address)).to.be.false;
      });

      context('when one of the wallets is not set by the contract', function () {
        it('successfully removes one valid account and skips the not set not', async function () {
          const {hashedDid, signature} = await this.vcRevocationUtil.makePayloadAndSignature(VC_ISSUER.did, VC_TOKEN_ID);
          await this.revocationRegistry.revokeVC(hashedDid, VC_TOKEN_ID, signature);

          await expect(this.contract.removeKycWallets([user.address, user3.address]))
            .to.emit(this.contract, 'KycWalletsRemoved')
            .withArgs([user.address]);
          expect(await this.contract.vcIdPerAccount(user.address)).to.equal(0);
        });

        it('successfully removes multiple valid accounts and skips the Vc id for the same wallet', async function () {
          const {hashedDid, signature} = await this.vcRevocationUtil.makePayloadAndSignature(VC_ISSUER.did, [VC_TOKEN_ID, VC_TOKEN_ID_2]);
          await this.revocationRegistry.batchRevokeVCs(hashedDid, [VC_TOKEN_ID, VC_TOKEN_ID_2], signature);

          await expect(this.contract.removeKycWallets([user.address, user3.address, user2.address]))
            .to.emit(this.contract, 'KycWalletsRemoved')
            .withArgs([user.address, user2.address]);

          expect(await this.contract.vcIdPerAccount(user.address)).to.equal(0);
          expect(await this.contract.vcIdPerAccount(user2.address)).to.equal(0);

          expect(await this.nodeRewardsContract.isKycWallet(user.address)).to.be.false;
          expect(await this.nodeRewardsContract.isKycWallet(user2.address)).to.be.false;
        });
      });
    });
  });

  context('Meta transaction', function () {
    it('returns the msg.sender', async function () {
      await this.contract.__msgSender();
    });

    it('returns the msg.data', async function () {
      await this.contract.__msgData();
    });
  });
});
