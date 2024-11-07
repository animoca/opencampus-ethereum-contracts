/* eslint-disable max-len */
const {keccak256, toUtf8Bytes, ZeroHash} = require('ethers');
const {ethers} = require('hardhat');
const {expect} = require('chai');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');

const {setupOpenCampusIssuersDIDRegistry} = require('../setup');

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

describe('OpenCampusIssuersDIDRegistry', function () {
  let accounts;
  let deployer, user, payoutWallet, other;

  before(async function () {
    accounts = await ethers.getSigners();
    [deployer, user, payoutWallet, other] = accounts;
  });

  const fixture = async function () {
    await setupOpenCampusIssuersDIDRegistry.call(this, deployer, user, payoutWallet);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  describe('addIssuer(string, address, string)', function () {
    context('When nobody has operator role', function () {
      it('addIssuer should throw error', async function () {
        await expect(this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.address)).to.be.revertedWithCustomError(
          this.didRegistry,
          'NotRoleHolder'
        );
      });

      it('removeIssuer should throw error', async function () {
        await expect(this.didRegistry.connect(deployer).removeIssuer(ISSUER.did, ISSUER.address)).to.be.revertedWithCustomError(
          this.didRegistry,
          'NotRoleHolder'
        );
      });

      it('expect error for other', async function () {
        await expect(this.didRegistry.connect(other).addIssuer(ISSUER.did, ISSUER.address)).to.be.revertedWithCustomError(
          this.didRegistry,
          'NotRoleHolder'
        );
      });
    });

    context('Test adding completely new issuer', function () {
      beforeEach(async function () {
        await this.didRegistry.grantRole(await this.didRegistry.OPERATOR_ROLE(), deployer);
      });

      it('isIssuerAllowedByDid(string, address)', async function () {
        const allowed = await this.didRegistry.isIssuerAllowed(ISSUER.did, ISSUER.address);
        expect(allowed).to.be.equal(false);
      });

      it('addIssuer(string,address)', async function () {
        await this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.address);
        const allowed = await this.didRegistry.isIssuerAllowed(ISSUER.did, ISSUER.address);
        expect(allowed).to.be.equal(true);
      });

      it('event IssuerAdded(string, address, address)', async function () {
        await expect(this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.address))
          .to.emit(this.didRegistry, 'IssuerAdded')
          .withArgs(ISSUER.hashedDid, ISSUER.address, deployer.address);
      });

      it('expect error for empty did', async function () {
        await expect(this.didRegistry.connect(deployer).addIssuer('', ISSUER.address)).to.be.revertedWithCustomError(
          this.didRegistry,
          'InvalidIssuer'
        );
      });

      it('expect error for empty address', async function () {
        await expect(this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ethers.ZeroAddress)).to.be.revertedWithCustomError(
          this.didRegistry,
          'InvalidIssuer'
        );
      });
    });

    context('Test when there are some issuers', function () {
      beforeEach(async function () {
        await this.didRegistry.grantRole(await this.didRegistry.OPERATOR_ROLE(), deployer);
        await this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.address);
      });

      it('isIssuerAllowed(string, address)', async function () {
        const allowed = await this.didRegistry.isIssuerAllowed(ISSUER.did, ISSUER.address);
        expect(allowed).to.be.equal(true);
      });

      it('removeIssuer(string, address)', async function () {
        await this.didRegistry.connect(deployer).removeIssuer(ISSUER.did, ISSUER.address);
        const allowed = await this.didRegistry.issuers(keccak256(toUtf8Bytes(ISSUER.did)), ISSUER.address);
        expect(allowed).to.be.equal(false);
      });

      it('event IssuerRemoved(string, address)', async function () {
        await expect(this.didRegistry.connect(deployer).removeIssuer(ISSUER.did, ISSUER.address))
          .to.emit(this.didRegistry, 'IssuerRemoved')
          .withArgs(ISSUER.hashedDid, ISSUER.address, deployer.address);
      });

      it('expect error for IssuerRemove when issuer did does not exist', async function () {
        await expect(this.didRegistry.connect(deployer).removeIssuer(ISSUER.did.replace('X', '1'), ISSUER.address)).to.be.revertedWithCustomError(
          this.didRegistry,
          'RelationshipDoesNotExist'
        );
      });

      it('expect error for IssuerRemove when issuer address does not exist', async function () {
        await expect(this.didRegistry.connect(deployer).removeIssuer(ISSUER.did, ISSUER.otherAddress)).to.be.revertedWithCustomError(
          this.didRegistry,
          'RelationshipDoesNotExist'
        );
      });
    });

    context('Test when there are some issuers and we make extra associations', function () {
      beforeEach(async function () {
        await this.didRegistry.grantRole(await this.didRegistry.OPERATOR_ROLE(), deployer);
        await this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.address);
      });

      it('addIssuer(string,address)', async function () {
        await this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.otherAddress);
        const allowed = await this.didRegistry.issuers(keccak256(toUtf8Bytes(ISSUER.did)), ISSUER.address);
        expect(allowed).to.be.equal(true);
        const OtherAllowed = await this.didRegistry.issuers(keccak256(toUtf8Bytes(ISSUER.did)), ISSUER.otherAddress);
        expect(OtherAllowed).to.be.equal(true);
      });

      it('event IssuerAdded(string, address, address) for other address', async function () {
        await expect(this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.otherAddress))
          .to.emit(this.didRegistry, 'IssuerAdded')
          .withArgs(ISSUER.hashedDid, ISSUER.otherAddress, deployer.address);
      });
    });

    context('Test when there are some issuers with multiple addresses', function () {
      beforeEach(async function () {
        await this.didRegistry.grantRole(await this.didRegistry.OPERATOR_ROLE(), deployer);
        await this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.address);
        await this.didRegistry.connect(deployer).addIssuer(ISSUER.did, ISSUER.otherAddress);
      });

      it('allowed for both', async function () {
        const allowed = await this.didRegistry.issuers(ISSUER.hashedDid, ISSUER.address);
        expect(allowed).to.be.equal(true);
        const OtherAllowed = await this.didRegistry.issuers(ISSUER.hashedDid, ISSUER.otherAddress);
        expect(OtherAllowed).to.be.equal(true);
      });

      it('removeIssuer(string, address) for one address', async function () {
        await this.didRegistry.connect(deployer).removeIssuer(ISSUER.did, ISSUER.otherAddress);
        const allowed = await this.didRegistry.issuers(ISSUER.hashedDid, ISSUER.address);
        expect(allowed).to.be.equal(true);
        const OtherAllowed = await this.didRegistry.issuers(ISSUER.hashedDid, ISSUER.otherAddress);
        expect(OtherAllowed).to.be.equal(false);
      });

      it('event IssuerRemoved(string, address)', async function () {
        await expect(this.didRegistry.connect(deployer).removeIssuer(ISSUER.did, ISSUER.otherAddress))
          .to.emit(this.didRegistry, 'IssuerRemoved')
          .withArgs(ISSUER.hashedDid, ISSUER.otherAddress, deployer.address);
      });
    });
  });
});
