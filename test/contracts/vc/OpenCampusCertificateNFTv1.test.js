/* eslint-disable max-len */
const {ethers} = require('hardhat');
const {AbiCoder, SigningKey, keccak256, toUtf8Bytes, ZeroHash, getBytes} = require('ethers');
const {expect} = require('chai');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');

const {setupOpenCampusCertificateNFTv1} = require('../setup');

const ISSUER = {
  did: 'did:key:zUC7KtygRhrsVGTMYx7LHWsg3dpPscW6VcBvps4KgoziJ2vYXW3er1vH9mCqM67q3Nqc3BXAy488po6zMu6yEXdWz4oRLD9rbP5abPAKFuZXqTiwyvrgDehsYtw1NjAhUSzcYiL',
  address: '0x58D027C315bAc47c60bD2491e2CBDce0977E3a37',
  name: 'test.edu',
  privateKey: '0x5a5c9a0954cc0a98584542c0fae233819133f8fc3ebafed632104bbe144ba2d7',
};

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

describe('OpenCampusCertificateNFTv1', function () {
  let accounts;
  let deployer, user, payoutWallet, other;

  before(async function () {
    accounts = await ethers.getSigners();
    [deployer, user, payoutWallet, other] = accounts;
  });

  const fixture = async function () {
    await setupOpenCampusCertificateNFTv1.call(this, deployer, user, payoutWallet);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
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

    context('When revocation registry is not set', function () {
      beforeEach(async function () {
        await this.ocNFT.mint(user.address, tokenId, metaData);
      });

      it('revert with RevocationRegistryNotSet when revocationRegistry is not set', async function () {
        const beforeBalance = await this.ocNFT.balanceOf(user.address);
        await expect(this.ocNFT.burn(tokenId)).to.be.revertedWithCustomError(this.ocNFT, 'RevocationRegistryNotSet');
        assert(beforeBalance === (await this.ocNFT.balanceOf(user.address)));
      });
    });

    context('When revocation registry is set', function () {
      beforeEach(async function () {
        await this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.address);
        await this.ocNFT.connect(deployer).setRevocationRegistry(this.revocationRegistry);
        await this.ocNFT.mint(user.address, tokenId, metaData);
      });

      it('revert with InvalidBurn when Token was not revoked', async function () {
        const beforeBalance = await this.ocNFT.balanceOf(user.address);
        await expect(this.ocNFT.burn(tokenId)).to.be.revertedWithCustomError(this.ocNFT, 'InvalidBurn');
        assert(beforeBalance === (await this.ocNFT.balanceOf(user.address)));
      });

      it('successful burn when Token is revoked', async function () {
        const beforeBalance = await this.ocNFT.balanceOf(user.address);
        const {hashedDid, nonce, signature} = makePayloadAndSignature(ISSUER.did, tokenId, 0n);
        await this.revocationRegistry.revokeVC(hashedDid, tokenId, nonce, signature);
        await this.ocNFT.burn(tokenId);
        assert(beforeBalance - 1n === (await this.ocNFT.balanceOf(user.address)));
      });
    });
  });

  describe('getApproved(uint256)', function () {
    it('revert when attempting to call the function', async function () {
      await expect(this.ocNFT.getApproved(1)).to.be.revertedWithCustomError(this.ocNFT, 'NoOperatorAllowed');
    });
  });

  describe('approve(address,uint256)', function () {
    it('revert when attempting to call the function', async function () {
      await expect(this.ocNFT.approve(other.address, 1)).to.be.revertedWithCustomError(this.ocNFT, 'TransferNotAllowed');
    });
  });

  describe('setApprovalForAll(address,bool)', function () {
    it('revert when attempting to call the function', async function () {
      await expect(this.ocNFT.setApprovalForAll(other.address, 1)).to.be.revertedWithCustomError(this.ocNFT, 'NoOperatorAllowed');
    });
  });

  describe('transferFrom(address,address,uint256)', function () {
    it('revert when attempting to call the function', async function () {
      await expect(this.ocNFT.transferFrom(user.address, other.address, 1)).to.be.revertedWithCustomError(this.ocNFT, 'TransferNotAllowed');
    });
  });

  describe('safeTransferFrom(address,address,uint256)', function () {
    it('revert when attempting to call the function', async function () {
      await expect(this.ocNFT['safeTransferFrom(address,address,uint256)'](user.address, other.address, 1)).to.be.revertedWithCustomError(
        this.ocNFT,
        'TransferNotAllowed'
      );
    });
  });

  describe('safeTransferFrom(address,address,uint256,bytes)', function () {
    it('revert when attempting to call the function', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [user.address, 1]);
      await expect(this.ocNFT['safeTransferFrom(address,address,uint256,bytes)'](user.address, other.address, 1, data)).to.be.revertedWithCustomError(
        this.ocNFT,
        'TransferNotAllowed'
      );
    });
  });

  describe('isApprovedForAll(address,address)', function () {
    it('revert when attempting to call the function', async function () {
      await expect(this.ocNFT.isApprovedForAll(deployer.address, other.address)).to.be.revertedWithCustomError(this.ocNFT, 'NoOperatorAllowed');
    });
  });

  describe('balanceOf(address)', function () {
    it('Zero balance when nothing is minted', async function () {
      expect(await this.ocNFT.balanceOf(user.address)).to.equal(0);
    });
  });
});
