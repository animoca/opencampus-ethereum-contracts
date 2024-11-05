/* eslint-disable max-len */
const {ethers} = require('hardhat');
const {parseUnits} = require('ethers');
const {expect} = require('chai');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');

const {RevocationUtil} = require('./utils/revocation');
const {setupOpenCampusCertificateNFTv1} = require('../setup');

const ISSUER = {
  did: 'did:key:zUC7KtygRhrsVGTMYx7LHWsg3dpPscW6VcBvps4KgoziJ2vYXW3er1vH9mCqM67q3Nqc3BXAy488po6zMu6yEXdWz4oRLD9rbP5abPAKFuZXqTiwyvrgDehsYtw1NjAhUSzcYiL',
  address: '0x58D027C315bAc47c60bD2491e2CBDce0977E3a37',
  name: 'test.edu',
  privateKey: '0x5a5c9a0954cc0a98584542c0fae233819133f8fc3ebafed632104bbe144ba2d7',
};

describe('OpenCampusCertificateNFTv1', function () {
  let accounts;
  let deployer, user, payoutWallet, other, issuer;

  before(async function () {
    accounts = await ethers.getSigners();
    [deployer, user, payoutWallet, other] = accounts;

    issuerSigner = await ethers.getImpersonatedSigner(ISSUER.address);
    // need to send some fund to the issuerSigner
    await deployer.sendTransaction({
      to: issuerSigner.address,
      value: parseUnits('0.1', 'ether'),
    });
  });

  const fixture = async function () {
    await setupOpenCampusCertificateNFTv1.call(this, deployer, user, payoutWallet);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  describe('_msgData()', function () {
    it('returns the msg.data', async function () {
      await this.ocNFT.__msgData();
    });
  });

  describe('mint(address, uint256, CertificateNFTv1MetaData.MetaData)', function () {
    beforeEach(async function () {
      const now = 1725268578828;
      metaData = {
        schemaVersion: 1,
        achievementType: 3,
        awardedDate: now,
        validFrom: now,
        validUtil: now + 365 * 24 * 3600 * 1000,
        issuerDid: ISSUER.did,
        achievementId: 'achievement-123-xyz',
      };
      tokenId = '0x3E68D6D114FC48F393517777295C8D64';
    });

    it('test failing when msg sender does not have minter role', async function () {
      await expect(this.ocNFT.connect(other).mint(user.address, tokenId, metaData)).to.be.revertedWithCustomError(this.ocNFT, 'NotRoleHolder');
    });

    context('Test successful minting', function () {
      beforeEach(async function () {
        await this.ocNFT.mint(user.address, tokenId, metaData);
      });

      it('User balance is 1', async function () {
        // test user balance is 1
        expect(await this.ocNFT.balanceOf(user.address)).to.equal(1);
      });

      it('Owner of the tokenId is user', async function () {
        expect(await this.ocNFT.ownerOf(tokenId)).to.equal(user.address);
      });

      it('NFT data is stored properly', async function () {
        // test the data stored is right
        const structData = await this.ocNFT.vcData(tokenId);
        expect(structData.issuerDid).to.equal(ISSUER.did);
        expect(structData.achievementId).to.equal('achievement-123-xyz');
        expect(structData.validFrom).to.equal(1725268578828);
      });

      it('mint the same tokenId again should fail', async function () {
        await expect(this.ocNFT.mint(user.address, tokenId, metaData)).to.be.revertedWithCustomError(this.ocNFT, 'ERC721ExistingToken');
      });
    });
  });

  describe('burn(uint256 tokenId)', function () {
    beforeEach(async function () {
      const now = 1725268578828;
      metaData = {
        schemaVersion: 1,
        achievementType: 3,
        awardedDate: now,
        validFrom: now,
        validUtil: now + 365 * 24 * 3600 * 1000,
        issuerDid: ISSUER.did,
        achievementId: 'achievement-123-xyz',
      };
      tokenId = '0x3E68D6D114FC48F393517777295C8D64';
    });

    it('test failing when msg sender does not have minter role', async function () {
      await expect(this.ocNFT.connect(other).mint(user.address, tokenId, metaData)).to.be.revertedWithCustomError(this.ocNFT, 'NotRoleHolder');
    });

    context('When revocation registry is set', function () {
      beforeEach(async function () {
        await this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.address);
        await this.ocNFT.connect(deployer).setRevocationRegistry(this.revocationRegistry);
        await this.ocNFT.mint(user.address, tokenId, metaData);
        ru = new RevocationUtil(ISSUER.privateKey, await this.revocationRegistry.getAddress());
      });

      it('revert with InvalidBurn when Token was not revoked', async function () {
        const beforeBalance = await this.ocNFT.balanceOf(user.address);
        await expect(this.ocNFT.burn(tokenId)).to.be.revertedWithCustomError(this.ocNFT, 'InvalidBurn');
        assert(beforeBalance === (await this.ocNFT.balanceOf(user.address)));
      });

      it('successful burn when Token is revoked', async function () {
        const beforeBalance = await this.ocNFT.balanceOf(user.address);
        const {hashedDid, signature} = await ru.makePayloadAndSignature(ISSUER.did, tokenId);
        await this.revocationRegistry.revokeVC(hashedDid, tokenId, signature);
        await this.ocNFT.burn(tokenId);
        assert(beforeBalance - 1n === (await this.ocNFT.balanceOf(user.address)));
      });

      it('when a token is burnt twice, revert with ERC721NonExistingToken error', async function () {
        const beforeBalance = await this.ocNFT.balanceOf(user.address);
        const {hashedDid, signature} = await ru.makePayloadAndSignature(ISSUER.did, tokenId);
        await this.revocationRegistry.revokeVC(hashedDid, tokenId, signature);
        await this.ocNFT.burn(tokenId);
        await expect(this.ocNFT.burn(tokenId)).to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonExistingToken');
      });

      it('when a token is burnt ownerOf should revert with ERC721NonExistingToken error', async function () {
        const beforeBalance = await this.ocNFT.balanceOf(user.address);
        const {hashedDid, signature} = await ru.makePayloadAndSignature(ISSUER.did, tokenId);
        await this.revocationRegistry.revokeVC(hashedDid, tokenId, signature);
        await this.ocNFT.burn(tokenId);
        await expect(this.ocNFT.ownerOf(tokenId)).to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonExistingToken');
      });
    });
  });

  describe('Test transfer functionality', function () {
    beforeEach(async function () {
      const now = 1725268578828;
      metaData = {
        schemaVersion: 1,
        achievementType: 3,
        awardedDate: now,
        validFrom: now,
        validUtil: now + 365 * 24 * 3600 * 1000,
        issuerDid: ISSUER.did,
        achievementId: 'achievement-123-xyz',
      };
      tokenId = '0x3E68D6D114FC48F393517777295C8D64';
      newWallet = '0x7E38bF369Aa7651a8cFCa040747f80C0120Ab2f4';
      fakeTokenId = '0x3E68D6D114FC48F39351777729500000';
      this.didRegistry.addIssuer(ISSUER.did, ISSUER.address);
      await this.ocNFT.mint(user.address, tokenId, metaData);
    });

    context('test no approvals at all', function () {
      it('user triggered transfer should revert with NotRoleHolder', async function () {
        // owner would fail
        await expect(this.ocNFT.connect(user).transferFrom(user.address, newWallet, tokenId)).to.be.revertedWithCustomError(
          this.ocNFT,
          'NotRoleHolder'
        );
        await expect(this.ocNFT.connect(user).safeTransferFrom(user.address, newWallet, tokenId)).to.be.revertedWithCustomError(
          this.ocNFT,
          'NotRoleHolder'
        );
        await expect(
          this.ocNFT.connect(user)['safeTransferFrom(address,address,uint256,bytes)'](user.address, newWallet, tokenId, '0x1111')
        ).to.be.revertedWithCustomError(this.ocNFT, 'NotRoleHolder');
      });

      it('issuer triggered transfer should revert with ERC721NonApprovedForTransfer', async function () {
        await expect(this.ocNFT.connect(issuerSigner).transferFrom(user.address, newWallet, tokenId))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(issuerSigner.address, user.address, tokenId);

        await expect(this.ocNFT.connect(issuerSigner).safeTransferFrom(user.address, newWallet, tokenId))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(issuerSigner.address, user.address, tokenId);

        await expect(this.ocNFT.connect(issuerSigner)['safeTransferFrom(address,address,uint256,bytes)'](user.address, newWallet, tokenId, '0x1111'))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(issuerSigner.address, user.address, tokenId);
      });

      it('operator triggered transfer should revert with ERC721NonApprovedForTransfer', async function () {
        await expect(this.ocNFT.connect(deployer).transferFrom(user.address, newWallet, tokenId))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(deployer.address, user.address, tokenId);

        await expect(this.ocNFT.connect(deployer).safeTransferFrom(user.address, newWallet, tokenId))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(deployer.address, user.address, tokenId);

        await expect(this.ocNFT.connect(deployer)['safeTransferFrom(address,address,uint256,bytes)'](user.address, newWallet, tokenId, '0x1111'))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(deployer.address, user.address, tokenId);
      });
    });

    context('test approving non issuer and non operator', function () {
      beforeEach(async function () {
        await this.ocNFT.connect(user).approve(other.address, tokenId);
        await this.ocNFT.connect(user).setApprovalForAll(other.address, true);
      });

      it('user triggered transfer should revert with NotRoleHolder', async function () {
        await expect(this.ocNFT.connect(user).transferFrom(user.address, newWallet, tokenId)).to.be.revertedWithCustomError(
          this.ocNFT,
          'NotRoleHolder'
        );
        await expect(this.ocNFT.connect(user).safeTransferFrom(user.address, newWallet, tokenId)).to.be.revertedWithCustomError(
          this.ocNFT,
          'NotRoleHolder'
        );
        await expect(
          this.ocNFT.connect(user)['safeTransferFrom(address,address,uint256,bytes)'](user.address, newWallet, tokenId, '0x1111')
        ).to.be.revertedWithCustomError(this.ocNFT, 'NotRoleHolder');
      });

      it('issuer triggered transfer should revert with ERC721NonApprovedForTransfer', async function () {
        await expect(this.ocNFT.connect(issuerSigner).transferFrom(user.address, newWallet, tokenId))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(issuerSigner.address, user.address, tokenId);

        await expect(this.ocNFT.connect(issuerSigner).safeTransferFrom(user.address, newWallet, tokenId))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(issuerSigner.address, user.address, tokenId);

        await expect(this.ocNFT.connect(issuerSigner)['safeTransferFrom(address,address,uint256,bytes)'](user.address, newWallet, tokenId, '0x1111'))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(issuerSigner.address, user.address, tokenId);
      });

      it('operator triggered transfer should revert with ERC721NonApprovedForTransfer', async function () {
        await expect(this.ocNFT.connect(deployer).transferFrom(user.address, newWallet, tokenId))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(deployer.address, user.address, tokenId);

        await expect(this.ocNFT.connect(deployer).safeTransferFrom(user.address, newWallet, tokenId))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(deployer.address, user.address, tokenId);

        await expect(this.ocNFT.connect(deployer)['safeTransferFrom(address,address,uint256,bytes)'](user.address, newWallet, tokenId, '0x1111'))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(deployer.address, user.address, tokenId);
      });
    });

    context('test approving issuer and trigger failing cases', function () {
      beforeEach(async function () {
        await this.ocNFT.connect(user).approve(issuerSigner.address, tokenId);
        await this.ocNFT.connect(user).setApprovalForAll(issuerSigner.address, true);
      });

      it('user triggered transfer should revert with NotRoleHolder', async function () {
        await expect(this.ocNFT.connect(user).transferFrom(user.address, newWallet, tokenId)).to.be.revertedWithCustomError(
          this.ocNFT,
          'NotRoleHolder'
        );
        await expect(this.ocNFT.connect(user).safeTransferFrom(user.address, newWallet, tokenId)).to.be.revertedWithCustomError(
          this.ocNFT,
          'NotRoleHolder'
        );
        await expect(
          this.ocNFT.connect(user)['safeTransferFrom(address,address,uint256,bytes)'](user.address, newWallet, tokenId, '0x1111')
        ).to.be.revertedWithCustomError(this.ocNFT, 'NotRoleHolder');
      });

      it('operator triggered transfer should revert with ERC721NonApprovedForTransfer', async function () {
        await expect(this.ocNFT.connect(deployer).transferFrom(user.address, newWallet, tokenId))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(deployer.address, user.address, tokenId);

        await expect(this.ocNFT.connect(deployer).safeTransferFrom(user.address, newWallet, tokenId))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(deployer.address, user.address, tokenId);

        await expect(this.ocNFT.connect(deployer)['safeTransferFrom(address,address,uint256,bytes)'](user.address, newWallet, tokenId, '0x1111'))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(deployer.address, user.address, tokenId);
      });
    });

    context('test approving operator and trigger failing cases from user and issuer', function () {
      beforeEach(async function () {
        await this.ocNFT.connect(user).approve(deployer.address, tokenId);
        await this.ocNFT.connect(user).setApprovalForAll(deployer.address, true);
      });

      it('user triggered transfer should revert with NotRoleHolder', async function () {
        await expect(this.ocNFT.connect(user).transferFrom(user.address, newWallet, tokenId)).to.be.revertedWithCustomError(
          this.ocNFT,
          'NotRoleHolder'
        );
        await expect(this.ocNFT.connect(user).safeTransferFrom(user.address, newWallet, tokenId)).to.be.revertedWithCustomError(
          this.ocNFT,
          'NotRoleHolder'
        );
        await expect(
          this.ocNFT.connect(user)['safeTransferFrom(address,address,uint256,bytes)'](user.address, newWallet, tokenId, '0x1111')
        ).to.be.revertedWithCustomError(this.ocNFT, 'NotRoleHolder');
      });

      it('issuer triggered transfer should revert with ERC721NonApprovedForTransfer', async function () {
        await expect(this.ocNFT.connect(issuerSigner).transferFrom(user.address, newWallet, tokenId))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(issuerSigner.address, user.address, tokenId);

        await expect(this.ocNFT.connect(issuerSigner).safeTransferFrom(user.address, newWallet, tokenId))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(issuerSigner.address, user.address, tokenId);

        await expect(this.ocNFT.connect(issuerSigner)['safeTransferFrom(address,address,uint256,bytes)'](user.address, newWallet, tokenId, '0x1111'))
          .to.be.revertedWithCustomError(this.ocNFT, 'ERC721NonApprovedForTransfer')
          .withArgs(issuerSigner.address, user.address, tokenId);
      });
    });

    context('approve(address to, uint256 tokenId)', function () {
      it('basical approval and flags', async function () {
        await this.ocNFT.connect(user).approve(deployer.address, tokenId);
        expect(await this.ocNFT.getApproved(tokenId)).to.be.equal(deployer.address);
      });

      it('An issuer being approved and transfer succeeded', async function () {
        await this.ocNFT.connect(user).approve(ISSUER.address, tokenId);
        await this.ocNFT.connect(issuerSigner).transferFrom(user.address, newWallet, tokenId);
        // owner has been updated to new owner
        expect(await this.ocNFT.ownerOf(tokenId)).to.equal(newWallet);
        // balance accounting is correct
        expect(await this.ocNFT.balanceOf(user.address)).to.equal(0);
        expect(await this.ocNFT.balanceOf(newWallet)).to.equal(1);
      });

      it('An operator being approved and transfer succeeded', async function () {
        await this.ocNFT.connect(user).approve(deployer.address, tokenId);
        await this.ocNFT.connect(deployer).transferFrom(user.address, newWallet, tokenId);
        // owner has been updated to new owner
        expect(await this.ocNFT.ownerOf(tokenId)).to.equal(newWallet);
        // balance accounting is correct
        expect(await this.ocNFT.balanceOf(user.address)).to.equal(0);
        expect(await this.ocNFT.balanceOf(newWallet)).to.equal(1);
      });
    });

    context('setApprovalForAll(address operator, bool approved)', function () {
      it('basical approve for all and flags', async function () {
        await this.ocNFT.connect(user).setApprovalForAll(deployer.address, true);
        expect(await this.ocNFT.isApprovedForAll(user.address, deployer.address)).to.be.equal(true);
      });

      it('An issuer being approved and transfer succeeded', async function () {
        await this.ocNFT.connect(user).setApprovalForAll(ISSUER.address, true);
        await this.ocNFT.connect(issuerSigner).transferFrom(user.address, newWallet, tokenId);
        // owner has been updated to new owner
        expect(await this.ocNFT.ownerOf(tokenId)).to.equal(newWallet);
        // balance accounting is correct
        expect(await this.ocNFT.balanceOf(user.address)).to.equal(0);
        expect(await this.ocNFT.balanceOf(newWallet)).to.equal(1);
      });

      it('An operator being approved and transfer succeeded', async function () {
        await this.ocNFT.connect(user).setApprovalForAll(deployer.address, true);
        await this.ocNFT.connect(deployer).transferFrom(user.address, newWallet, tokenId);
        // owner has been updated to new owner
        expect(await this.ocNFT.ownerOf(tokenId)).to.equal(newWallet);
        // balance accounting is correct
        expect(await this.ocNFT.balanceOf(user.address)).to.equal(0);
        expect(await this.ocNFT.balanceOf(newWallet)).to.equal(1);
      });
    });

    context('safeTransferFrom(address from, address to, uint256 tokenId)', function () {
      beforeEach(async function () {
        await this.ocNFT.connect(user).approve(deployer, tokenId);
      });

      it('A successful transfer that successfully call onReceive function', async function () {
        const receiverAddr = this.erc721ReceiverAccept.getAddress();
        await expect(this.ocNFT.connect(deployer).safeTransferFrom(user.address, receiverAddr, tokenId))
          .to.emit(this.erc721ReceiverAccept, 'ERC721Received')
          .withArgs(deployer.address, user.address, tokenId, '0x');
      });

      it('test reverting when receiver contract failed to receive', async function () {
        const receiverAddr = this.erc721ReceiverReject.getAddress();
        await expect(this.ocNFT.connect(deployer).safeTransferFrom(user.address, receiverAddr, tokenId)).to.be.revertedWithCustomError(
          this.ocNFT,
          'ERC721SafeTransferRejected'
        );
      });
    });

    context('safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data)', function () {
      beforeEach(async function () {
        await this.ocNFT.connect(user).approve(deployer, tokenId);
      });

      it('A successful transfer that successfully call onReceive function', async function () {
        const receiverAddr = this.erc721ReceiverAccept.getAddress();
        await expect(this.ocNFT.connect(deployer)['safeTransferFrom(address,address,uint256,bytes)'](user.address, receiverAddr, tokenId, '0x1111'))
          .to.emit(this.erc721ReceiverAccept, 'ERC721Received')
          .withArgs(deployer.address, user.address, tokenId, '0x1111');
      });

      it('test reverting when receiver contract failed to receive', async function () {
        const receiverAddr = this.erc721ReceiverReject.getAddress();
        await expect(
          this.ocNFT.connect(deployer)['safeTransferFrom(address,address,uint256,bytes)'](user.address, receiverAddr, tokenId, '0x1111')
        ).to.be.revertedWithCustomError(this.ocNFT, 'ERC721SafeTransferRejected');
      });
    });
  });
});
