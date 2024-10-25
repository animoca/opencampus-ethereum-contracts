/* eslint-disable max-len */
const {ethers} = require('hardhat');
const {keccak256, toUtf8Bytes} = require('ethers');
const {expect} = require('chai');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {RevocationUtil} = require('./utils/revocation');

const {setupOpenCampusRevocationRegistry} = require('../setup');

const ISSUER_DID =
  'did:key:zUC7KtygRhrsVGTMYx7LHWsg3dpPscW6VcBvps4KgoziJ2vYXW3er1vH9mCqM67q3Nqc3BXAy488po6zMu6yEXdWz4oRLD9rbP5abPAKFuZXqTiwyvrgDehsYtw1NjAhUSzcYiL';

const ISSUER = {
  did: ISSUER_DID,
  address: '0x58D027C315bAc47c60bD2491e2CBDce0977E3a37',
  name: 'test.edu',
  privateKey: '0x5a5c9a0954cc0a98584542c0fae233819133f8fc3ebafed632104bbe144ba2d7',
  otherAddress: '0x4CF193df17CcCbF3B3712e95ee0CD447282D82A4',
  hashedDid: keccak256(toUtf8Bytes(ISSUER_DID)),
};

const TOKEN_ID = '0x3E68D6D114FC48F393517777295C8D64';
const TOKEN_IDS = ['0x3E68D6D114FC48F393517777295C8D64', '0x3E68D6D114FC48F393517777295C8D65', '0x3E68D6D114FC48F393517777295C8D66'];

describe('OpenCampusCertificateRevocationRegistry', function () {
  let accounts;
  let deployer, user, payoutWallet, other;

  before(async function () {
    accounts = await ethers.getSigners();
    [deployer, user, payoutWallet, other] = accounts;
  });

  const fixture = async function () {
    await setupOpenCampusRevocationRegistry.call(this, deployer, user, payoutWallet);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
    ru = new RevocationUtil(ISSUER.privateKey, await this.revocationRegistry.getAddress());
  });

  describe('Test for invalid issuer not in DIDRegistry', function () {
    context('Test for rejections', function () {
      it('revokeVC should revert with InvalidIssuer', async function () {
        const {hashedDid, tokenId, signature} = await ru.makePayloadAndSignature(ISSUER.did, TOKEN_ID);
        await expect(this.revocationRegistry.connect(deployer).revokeVC(hashedDid, tokenId, signature)).to.be.revertedWithCustomError(
          this.revocationRegistry,
          'InvalidIssuer'
        );
      });

      it('batchRevokeVCs should revert with InvalidIssuer', async function () {
        const {hashedDid, tokenId: tokenIds, signature} = await ru.makePayloadAndSignature(ISSUER.did, TOKEN_IDS);
        await expect(this.revocationRegistry.connect(deployer).batchRevokeVCs(hashedDid, tokenIds, signature)).to.be.revertedWithCustomError(
          this.revocationRegistry,
          'InvalidIssuer'
        );
      });

      it('isRevoked should return false for anything', async function () {
        const revoked = await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_ID);
        assert(revoked === false);
      });
    });
  });

  describe('Test for having valid Issuers in DiDRegistry', function () {
    context('Test for happy cases', function () {
      beforeEach(async function () {
        await this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.address);
      });

      it('revokeVC(bytes32 hashedIssuerDid, uint256 vcId, bytes calldata signature)', async function () {
        const {hashedDid, tokenId, signature} = await ru.makePayloadAndSignature(ISSUER.did, TOKEN_ID);
        await this.revocationRegistry.connect(deployer).revokeVC(hashedDid, tokenId, signature);
        assert(true === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_ID)));
      });

      it('batchRevokeVCs(bytes32 hashedIssuerDid, uint256[] calldata vcIds, bytes calldata signature)', async function () {
        const {hashedDid, tokenId: tokenIds, signature} = await ru.makePayloadAndSignature(ISSUER.did, TOKEN_IDS);
        await this.revocationRegistry.connect(deployer).batchRevokeVCs(hashedDid, tokenIds, signature);
        assert(true === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_IDS[0])));
        assert(true === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_IDS[1])));
        assert(true === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_IDS[2])));
      });
    });

    context('Test for failed cases', function () {
      beforeEach(async function () {
        await this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.address);
      });

      it('revokeVC reverted when signature is invalid for the whitelisted addresses', async function () {
        const otherPrivateKey = '0x5a5c9a0954cc0a98584542c0fae233819133f8fc3ebafed632104bbe10000000';

        const {hashedDid, tokenId, signature} = await ru.makePayloadAndSignature(ISSUER.did, TOKEN_ID, otherPrivateKey);
        await expect(this.revocationRegistry.connect(deployer).revokeVC(hashedDid, tokenId, signature)).to.be.revertedWithCustomError(
          this.revocationRegistry,
          'InvalidIssuer'
        );
      });

      it('batchRevokeVCs reverted when signature is invalid for the whitelisted addresses', async function () {
        const otherPrivateKey = '0x5a5c9a0954cc0a98584542c0fae233819133f8fc3ebafed632104bbe10000000';
        const {hashedDid, tokenId: tokenIds, signature} = await ru.makePayloadAndSignature(ISSUER.did, TOKEN_IDS, otherPrivateKey);
        await expect(this.revocationRegistry.connect(deployer).batchRevokeVCs(hashedDid, tokenIds, signature)).to.be.revertedWithCustomError(
          this.revocationRegistry,
          'InvalidIssuer'
        );
      });

      it('test bad signature check for revokeVC', async function () {
        const {hashedDid, tokenId, nonce, signature} = await ru.makePayloadAndSignature(ISSUER.did, TOKEN_ID);
        await expect(this.revocationRegistry.connect(deployer).revokeVC(hashedDid, tokenId, signature.slice(1))).to.be.revertedWith(
          'ECDSA: invalid signature length'
        );
      });

      it('btest bad signature check for batchRevokeVCs', async function () {
        const {hashedDid, tokenId: tokenIds, signature} = await ru.makePayloadAndSignature(ISSUER.did, TOKEN_IDS);
        await expect(this.revocationRegistry.connect(deployer).batchRevokeVCs(hashedDid, tokenIds, signature.slice(1))).to.be.revertedWith(
          'ECDSA: invalid signature length'
        );
      });
    });
  });

  describe('Test for complex DIDRegistry removal after revocation', function () {
    context('Test for rejections', function () {
      beforeEach(async function () {
        await this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.address);
        await this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.otherAddress);
      });

      it('revokeVC success then fail on checkIfRevoked after removal of issuer', async function () {
        const {hashedDid, tokenId, signature} = await ru.makePayloadAndSignature(ISSUER.did, TOKEN_ID);
        await this.revocationRegistry.connect(deployer).revokeVC(hashedDid, tokenId, signature);
        assert(true === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_ID)));

        // remove issuer
        await this.didRegistry.connect(deployer).removeIssuer(ISSUER.did, ISSUER.address);
        assert(false === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_ID)));
      });

      it('batchRevokeVCs success then fail on checkIfRevoked after removal of issuer', async function () {
        const {hashedDid, tokenId: tokenIds, signature} = await ru.makePayloadAndSignature(ISSUER.did, TOKEN_IDS);
        await this.revocationRegistry.connect(deployer).batchRevokeVCs(hashedDid, tokenIds, signature);
        assert(true === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_IDS[0])));
        assert(true === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_IDS[1])));
        assert(true === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_IDS[2])));

        // remove issuer
        await this.didRegistry.connect(deployer).removeIssuer(ISSUER.did, ISSUER.address);
        assert(false === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_IDS[0])));
        assert(false === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_IDS[1])));
        assert(false === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_IDS[2])));
      });
    });
  });
});
