/* eslint-disable max-len */
const {ethers} = require('hardhat');
const {AbiCoder, SigningKey, keccak256, getBytes} = require('ethers');
const ethersjs = require('ethers');
const {expect} = require('chai');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {RevocationUtil} = require('./utils/revocation');

const {setupOpenCampusCertificateNFTMinter} = require('../setup');

const ISSUER = {
  did: 'did:key:zUC7KtygRhrsVGTMYx7LHWsg3dpPscW6VcBvps4KgoziJ2vYXW3er1vH9mCqM67q3Nqc3BXAy488po6zMu6yEXdWz4oRLD9rbP5abPAKFuZXqTiwyvrgDehsYtw1NjAhUSzcYiL',
  address: '0x58D027C315bAc47c60bD2491e2CBDce0977E3a37',
  name: 'test.edu',
  privateKey: '0x5a5c9a0954cc0a98584542c0fae233819133f8fc3ebafed632104bbe144ba2d7',
};

const signatureWithoutVersion =
  '0x5d99b6f7f6d1f73d1a26497f2b1c89b24c0993913f86e9a2d02cd69887d9c94f3c880358579d811b21dd1b7fd9bb01c1d81d10e69f0384e675c32b39643be892';

describe('OpenCampusCertificateNFTMinter', function () {
  let accounts;
  let deployer, user, payoutWallet, other;

  before(async function () {
    accounts = await ethers.getSigners();
    [deployer, user, payoutWallet, other] = accounts;
  });

  const fixture = async function () {
    await setupOpenCampusCertificateNFTMinter.call(this, deployer, user, payoutWallet);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  describe('mint(address, uint256, CertificateNFTv1MetaData.MetaData, bytes)', function () {
    beforeEach(async function () {
      const encoder = AbiCoder.defaultAbiCoder();
      const now = 1725268578828;
      tokenId = '0x3E68D6D114FC48F393517777295C8D64';
      holderAddress = user.address;
      metaData = {
        schemaVersion: 1,
        achievementType: 3,
        awardedDate: now,
        validFrom: now,
        validUtil: now + 365 * 24 * 3600 * 1000,
        issuerDid: ISSUER.did,
        achievementId: 'achievement-123-xyz',
      };
      const encodedParams = encoder.encode(
        ['address', 'uint256', 'tuple(uint16, uint16, uint64, uint64, uint64, string, string)'],
        [holderAddress, tokenId, Object.values(metaData)]
      );
      const paramHash = keccak256(encodedParams);
      hashBytes = getBytes(paramHash);
      const signingKey = new SigningKey(ISSUER.privateKey);
      rawSig = signingKey.sign(hashBytes);
      signatureBytes = getBytes(rawSig.serialized);
    });

    context('When issuer is not whitelisted', function () {
      it('trigger minting', async function () {
        await expect(this.ocMinter.mint(holderAddress, tokenId, metaData, signatureBytes)).to.be.revertedWithCustomError(
          this.ocMinter,
          'IssuerNotAllowed'
        );
      });
    });

    context('When issuer is whitelisted', function () {
      beforeEach(async function () {
        await this.didRegistry.addIssuer(ISSUER.did, ISSUER.address);
      });

      it('User balance is 1', async function () {
        await this.ocMinter.mint(holderAddress, tokenId, metaData, signatureBytes);
        // test user balance is 1
        expect(await this.ocNFT.balanceOf(user.address)).to.equal(1);
        expect(await this.ocNFT.ownerOf(tokenId)).to.equal(user.address);
      });

      it('Owner of the tokenId is user', async function () {
        await this.ocMinter.mint(holderAddress, tokenId, metaData, signatureBytes);
        expect(await this.ocNFT.ownerOf(tokenId)).to.equal(user.address);
      });

      it('NFT data is stored properly', async function () {
        await this.ocMinter.mint(holderAddress, tokenId, metaData, signatureBytes);
        // test the data stored is right
        const structData = await this.ocNFT.vcData(tokenId);
        expect(structData.issuerDid).to.equal(ISSUER.did);
        expect(structData.achievementType).to.equal(metaData.achievementType);
        expect(structData.validFrom).to.equal(metaData.validFrom);
      });

      it('when signature eth address does not match', async function () {
        const otherPrivateKey = '0x5a5c9a0954cc0a98584542c0fae233819133f8fc3ebafed632104bbe10000000';
        const signingKey = new SigningKey(otherPrivateKey);
        const rawSig = signingKey.sign(hashBytes);
        const otherSig = getBytes(rawSig.serialized);
        await expect(this.ocMinter.mint(holderAddress, tokenId, metaData, otherSig)).to.be.revertedWithCustomError(this.ocMinter, 'IssuerNotAllowed');
      });

      it('when signed did does not match whitelisted did', async function () {
        // change the issuerDid
        metaData.issuerDid =
          'did:key:zUC7DTpDc1nGT3mNY87csBwzjHbqSaoz3ZrRSj8kTFKm6Km3yuuirSov83YhS3GVnG5o7HdLUFUqduJxc1rpxtvU4X5caG6CXQuaYTxCAvEeRnQ8K2Dx9CLqypnyWiFbUenL7AN';
        await expect(this.ocMinter.mint(holderAddress, tokenId, metaData, signatureBytes)).to.be.revertedWithCustomError(
          this.ocMinter,
          'IssuerNotAllowed'
        );
      });

      it('test invalid signature', async function () {
        // compact serialized signature is only 64 bytes instead of 65 bytes as expected
        const otherSig = getBytes(rawSig.compactSerialized);
        await expect(this.ocMinter.mint(holderAddress, tokenId, metaData, otherSig)).to.be.revertedWith('ECDSA: invalid signature length');
      });

      it('test signature that would cause ecrecover to recover zero address', async function () {
        // This InvalidSignature error would be thrown from the openzeppelin contract ECDSA.sol line #140
        // explicitly when the recovered address from ecrecover is zero address, which can be caused by having v being zero.
        const badSigRecoveredToZero =
          '0x020d671b80fbd20466d8cb65cef79a24e3bca3fdf82e9dd89d78e7a4c4c045bd72944c20bb1d839e76ee6bb69fed61f64376c37799598b40b8c49148f3cdd80000';
        await expect(this.ocMinter.mint(holderAddress, tokenId, metaData, badSigRecoveredToZero)).to.be.revertedWith('ECDSA: invalid signature');
      });
    });

    context('When RevocationRegistry is set', function () {
      beforeEach(async function () {
        await this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.address);
        await this.ocMinter.connect(deployer).setRevocationRegistry(this.revocationRegistry);
        ru = new RevocationUtil(ISSUER.privateKey, await this.revocationRegistry.getAddress());
      });

      it('when nothing is revoked, successful minting', async function () {
        await this.ocMinter.mint(holderAddress, tokenId, metaData, signatureBytes);
        expect(await this.ocNFT.balanceOf(user.address)).to.equal(1);
      });

      it('revert with VcRevoked when the tokenId has already been revoked', async function () {
        const {hashedDid, signature} = await ru.makePayloadAndSignature(ISSUER.did, tokenId);
        await this.revocationRegistry.revokeVC(hashedDid, tokenId, signature);
        await expect(this.ocMinter.mint(holderAddress, tokenId, metaData, signatureBytes)).to.be.revertedWithCustomError(this.ocMinter, 'VcRevoked');
        expect(await this.ocNFT.balanceOf(user.address)).to.equal(0);
      });
    });
  });
});
