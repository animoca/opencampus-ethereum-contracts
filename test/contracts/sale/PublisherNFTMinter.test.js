const {ethers} = require('hardhat');
const {expect} = require('chai');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');

const {setupPublisherNFTMinter} = require('../setup');

describe('PublisherNFTMinter', function () {
  let accounts;
  let deployer, user, payoutWallet, other, genesisNft0Holder, genesisNft1Holder;

  before(async function () {
    accounts = await ethers.getSigners();
    [deployer, user, payoutWallet, other, genesisNft0Holder, genesisNft1Holder] = accounts;
  });

  const fixture = async function () {
    await setupPublisherNFTMinter.call(this, deployer, user, payoutWallet, other, genesisNft0Holder, genesisNft1Holder);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  describe('constructor(address,address,uint16,address,uint256)', function () {
    it('sets the publisher NFT address', async function () {
      expect(await this.minter.PUBLISHER_NFT()).to.equal(await this.publisherNFT.getAddress());
    });

    it('sets the LZ endpoint address', async function () {
      expect(await this.minter.LZ_ENDPOINT()).to.equal(await this.lzEndpoint.getAddress());
    });

    it('sets the LZ src chain id ', async function () {
      expect(await this.minter.LZ_SRC_CHAINID()).to.equal(0);
    });

    it('sets the LZ src address ', async function () {
      expect(await this.minter.LZ_SRC_ADDRESS()).to.equal(await this.sale.getAddress());
    });

    it('sets the mint supply limit', async function () {
      expect(await this.minter.MINT_SUPPLY_LIMIT()).to.equal(2);
    });
  });

  describe('lzReceive(uint16,bytes,uint64,bytes)', function () {
    beforeEach(async function () {
      this.payload = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [user.address, 1]);
    });

    it('reverts when not called by the LZ endpoint', async function () {
      await expect(this.minter.lzReceive(0, '0x', 0, this.payload))
        .to.be.revertedWithCustomError(this.minter, 'UnauthorizedSender')
        .withArgs(deployer.address);
    });

    it('reverts with an incorrect src chain id', async function () {
      await expect(this.lzEndpoint.callLzReceive(666, this.sale.getAddress(), this.minter.getAddress(), this.payload))
        .to.be.revertedWithCustomError(this.minter, 'IncorrectSrcChainId')
        .withArgs(666);
    });

    it('reverts with an incorrect src address', async function () {
      await expect(this.lzEndpoint.callLzReceive(0, deployer.address, this.minter.getAddress(), this.payload))
        .to.be.revertedWithCustomError(this.minter, 'IncorrectSrcAddress')
        .withArgs(deployer.address);
    });

    it('reverts when the mint supply is insufficient', async function () {
      await this.lzEndpoint.callLzReceive(
        0,
        this.sale.getAddress(),
        this.minter.getAddress(),
        ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [user.address, 2])
      );
      await expect(this.lzEndpoint.callLzReceive(0, this.sale.getAddress(), this.minter.getAddress(), this.payload)).to.be.revertedWithCustomError(
        this.minter,
        'InsufficientMintSupply'
      );
    });

    context('when successful', function () {
      beforeEach(async function () {
        this.receipt = await this.lzEndpoint.callLzReceive(0, this.sale.getAddress(), this.minter.getAddress(), this.payload);
      });

      it('increases the mint count', async function () {
        expect(await this.minter.mintCount()).to.equal(1);
      });

      it('mints publisher tokens', async function () {
        await expect(this.receipt).to.emit(this.publisherNFT, 'Transfer').withArgs(ethers.ZeroAddress, user.address, 0);
      });
    });
  });

  describe('forceResumeReceive()', function () {
    it('reverts when not called by the contract owner', async function () {
      await expect(this.minter.connect(other).forceResumeReceive())
        .to.be.revertedWithCustomError(this.minter, 'NotContractOwner')
        .withArgs(other.address);
    });

    it('calls forceResumeReceive on the LZ endpoint', async function () {
      await expect(this.minter.forceResumeReceive())
        .to.be.emit(this.lzEndpoint, 'ForceResume')
        .withArgs(0, ethers.solidityPacked(['address', 'address'], [await this.sale.getAddress(), await this.minter.getAddress()]));
    });
  });

  describe('retryPayload(address,uint256)', function () {
    it('calls forceResumeReceive on the LZ endpoint', async function () {
      await expect(this.minter.retryPayload(user.address, 1))
        .to.be.emit(this.lzEndpoint, 'PayloadRetry')
        .withArgs(
          0,
          ethers.solidityPacked(['address', 'address'], [await this.sale.getAddress(), await this.minter.getAddress()]),
          ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [user.address, 1])
        );
    });
  });
});
