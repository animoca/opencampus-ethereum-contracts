/* eslint-disable max-len */
const {ethers} = require('hardhat');
const {AbiCoder, SigningKey, keccak256, toUtf8Bytes, ZeroHash, getBytes} = require('ethers');
const {expect} = require('chai');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');

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

const makePayloadAndSignature = (issuerDid, tokenId, nonce, privateKey) => {
  const encoder = AbiCoder.defaultAbiCoder();
  const hashedDid = keccak256(toUtf8Bytes(issuerDid));

  let encodedParams;
  if (Array.isArray(tokenId)) {
    encodedParams = encoder.encode(['bytes32', 'uint256[]', 'uint256'], [hashedDid, tokenId, nonce]);
  } else {
    encodedParams = encoder.encode(['bytes32', 'uint256', 'uint256'], [hashedDid, tokenId, nonce]);
  }
  const paramHash = keccak256(encodedParams);
  hashBytes = getBytes(paramHash);
  const signingKey = new SigningKey(privateKey || ISSUER.privateKey);
  rawSig = signingKey.sign(hashBytes);
  signatureBytes = getBytes(rawSig.serialized);
  return {
    hashedDid,
    tokenId,
    nonce,
    signature: signatureBytes,
  };
};

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
  });

  describe('Test for invalid issuer not in DIDRegistry', function () {
    context('Test for rejections', function () {
      beforeEach(async function () {
        currentNonce = await this.revocationRegistry.currentNonce();
      });

      it('revokeVC should revert with InvalidIssuer', async function () {
        const prevNonce = currentNonce;
        const {hashedDid, tokenId, nonce, signature} = makePayloadAndSignature(ISSUER.did, TOKEN_ID, currentNonce);
        await expect(this.revocationRegistry.connect(deployer).revokeVC(hashedDid, tokenId, nonce, signature)).to.be.revertedWithCustomError(
          this.revocationRegistry,
          'InvalidIssuer'
        );
        // nonce should be the same
        const newNonce = await this.revocationRegistry.currentNonce();
        assert(prevNonce === newNonce);
      });

      it('batchRevokeVCs should revert with InvalidIssuer', async function () {
        const prevNonce = currentNonce;
        const {hashedDid, tokenId: tokenIds, nonce, signature} = makePayloadAndSignature(ISSUER.did, TOKEN_IDS, currentNonce);
        await expect(this.revocationRegistry.connect(deployer).batchRevokeVCs(hashedDid, tokenIds, nonce, signature)).to.be.revertedWithCustomError(
          this.revocationRegistry,
          'InvalidIssuer'
        );
        // nonce should be the same
        const newNonce = await this.revocationRegistry.currentNonce();
        assert(prevNonce === newNonce);
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

      it('revokeVC(bytes32 hashedIssuerDid, uint256 vcId, uint256 nonce, bytes calldata signature)', async function () {
        const currentNonce = await this.revocationRegistry.currentNonce();
        const {hashedDid, tokenId, nonce, signature} = makePayloadAndSignature(ISSUER.did, TOKEN_ID, currentNonce);
        await this.revocationRegistry.connect(deployer).revokeVC(hashedDid, tokenId, nonce, signature);
        // nonce should have been moved
        const newNonce = await this.revocationRegistry.currentNonce();
        assert(currentNonce + 1n === newNonce);
        assert(true === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_ID)));
      });

      it('batchRevokeVCs(bytes32 hashedIssuerDid, uint256[] calldata vcIds, uint256 nonce, bytes calldata signature)', async function () {
        const currentNonce = await this.revocationRegistry.currentNonce();
        const {hashedDid, tokenId: tokenIds, nonce, signature} = makePayloadAndSignature(ISSUER.did, TOKEN_IDS, currentNonce);
        await this.revocationRegistry.connect(deployer).batchRevokeVCs(hashedDid, tokenIds, nonce, signature);
        // nonce should have been moved
        const newNonce = await this.revocationRegistry.currentNonce();
        assert(currentNonce + 1n === newNonce);
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
        const currentNonce = await this.revocationRegistry.currentNonce();

        const {hashedDid, tokenId, nonce, signature} = makePayloadAndSignature(ISSUER.did, TOKEN_ID, currentNonce, otherPrivateKey);
        await expect(this.revocationRegistry.connect(deployer).revokeVC(hashedDid, tokenId, nonce, signature)).to.be.revertedWithCustomError(
          this.revocationRegistry,
          'InvalidIssuer'
        );
      });

      it('batchRevokeVCs reverted when signature is invalid for the whitelisted addresses', async function () {
        const otherPrivateKey = '0x5a5c9a0954cc0a98584542c0fae233819133f8fc3ebafed632104bbe10000000';
        const currentNonce = await this.revocationRegistry.currentNonce();
        const {hashedDid, tokenId: tokenIds, nonce, signature} = makePayloadAndSignature(ISSUER.did, TOKEN_IDS, currentNonce, otherPrivateKey);
        await expect(this.revocationRegistry.connect(deployer).batchRevokeVCs(hashedDid, tokenIds, nonce, signature)).to.be.revertedWithCustomError(
          this.revocationRegistry,
          'InvalidIssuer'
        );
      });

      it('Test for failed replay attack on revokeVC', async function () {
        const currentNonce = await this.revocationRegistry.currentNonce();
        const {hashedDid, tokenId, nonce, signature} = makePayloadAndSignature(ISSUER.did, TOKEN_ID, currentNonce);
        await this.revocationRegistry.connect(deployer).revokeVC(hashedDid, tokenId, nonce, signature);
        // nonce should have been moved
        const newNonce = await this.revocationRegistry.currentNonce();
        assert(currentNonce + 1n === newNonce);
        assert(true === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_ID)));
        await expect(this.revocationRegistry.connect(deployer).revokeVC(hashedDid, tokenId, nonce, signature)).to.be.revertedWithCustomError(
          this.revocationRegistry,
          'InvalidNonce'
        );
      });

      it('Test for failed replay attack on batchRevokeVCs', async function () {
        const currentNonce = await this.revocationRegistry.currentNonce();
        const {hashedDid, tokenId: tokenIds, nonce, signature} = makePayloadAndSignature(ISSUER.did, TOKEN_IDS, currentNonce);
        await this.revocationRegistry.connect(deployer).batchRevokeVCs(hashedDid, tokenIds, nonce, signature);
        // nonce should have been moved
        const newNonce = await this.revocationRegistry.currentNonce();
        assert(currentNonce + 1n === newNonce);
        await expect(this.revocationRegistry.connect(deployer).batchRevokeVCs(hashedDid, tokenIds, nonce, signature)).to.be.revertedWithCustomError(
          this.revocationRegistry,
          'InvalidNonce'
        );
      });

      it('test bad signature check for revokeVC', async function () {
        const currentNonce = await this.revocationRegistry.currentNonce();
        const {hashedDid, tokenId, nonce, signature} = makePayloadAndSignature(ISSUER.did, TOKEN_ID, currentNonce);
        await expect(this.revocationRegistry.connect(deployer).revokeVC(hashedDid, tokenId, nonce, signature.slice(1))).to.be.revertedWithCustomError(
          this.revocationRegistry,
          'InvalidSignature'
        );
      });

      it('btest bad signature check for batchRevokeVCs', async function () {
        const currentNonce = await this.revocationRegistry.currentNonce();
        const {hashedDid, tokenId: tokenIds, nonce, signature} = makePayloadAndSignature(ISSUER.did, TOKEN_IDS, currentNonce);
        await expect(
          this.revocationRegistry.connect(deployer).batchRevokeVCs(hashedDid, tokenIds, nonce, signature.slice(1))
        ).to.be.revertedWithCustomError(this.revocationRegistry, 'InvalidSignature');
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
        const currentNonce = await this.revocationRegistry.currentNonce();
        const {hashedDid, tokenId, nonce, signature} = makePayloadAndSignature(ISSUER.did, TOKEN_ID, currentNonce);
        await this.revocationRegistry.connect(deployer).revokeVC(hashedDid, tokenId, nonce, signature);
        assert(true === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_ID)));

        // remove issuer
        await this.didRegistry.connect(deployer).removeIssuer(ISSUER.did, ISSUER.address);
        assert(false === (await this.revocationRegistry.isRevoked(ISSUER.hashedDid, TOKEN_ID)));
      });

      it('batchRevokeVCs success then fail on checkIfRevoked after removal of issuer', async function () {
        const currentNonce = await this.revocationRegistry.currentNonce();
        const {hashedDid, tokenId: tokenIds, nonce, signature} = makePayloadAndSignature(ISSUER.did, TOKEN_IDS, currentNonce);
        await this.revocationRegistry.connect(deployer).batchRevokeVCs(hashedDid, tokenIds, nonce, signature);
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
