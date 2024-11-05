const {ethers} = require('hardhat');
const {expect} = require('chai');
const {expectRevert} = require('@animoca/ethereum-contract-helpers/src/test/revert');
const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {getForwarderRegistryAddress, getTokenMetadataResolverPerTokenAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');
const {time} = require('@nomicfoundation/hardhat-network-helpers');
const keccak256 = require('keccak256');

async function getBlockTimestamp(tx) {
  const block = await ethers.provider.getBlock(tx.blockNumber);
  return BigInt(block.timestamp);
}

const DEFAULT_GRACE_PERIOD = 5n;

describe('EDUNodeKeyRental', function () {
  before(async function () {
    [deployer, user1, user2, user3, user4, other] = await ethers.getSigners();
  });

  const fixture = async function () {
    const metadataResolverAddress = await getTokenMetadataResolverPerTokenAddress();
    const forwarderRegistryAddress = await getForwarderRegistryAddress();

    this.nodeKeyContract = await deployContract('EDUNodeKey', 'EDU Principal Node Key', 'EDUKey', metadataResolverAddress, forwarderRegistryAddress);
    await this.nodeKeyContract.grantRole(await this.nodeKeyContract.MINTER_ROLE(), deployer.address);

    this.rentalReasonCode = keccak256('NODE_KEY_RENTAL');

    const nodeKeyContractTotalSupply = 500;
    this.monthlyMaintenanceFee = 1n;
    const tokenIds = Array.from({length: nodeKeyContractTotalSupply}).map((_, idx) => idx);

    const initialOCPAmount = ethers.MaxUint256 / 2n;
    this.ocp = await deployContract('OCPMock', [user1, user2, user3], [initialOCPAmount, initialOCPAmount, initialOCPAmount]);

    this.rentalContract = await deployContract(
      'EDUNodeKeyRentalMock',
      this.nodeKeyContract.target,
      this.ocp.target,
      this.monthlyMaintenanceFee,
      forwarderRegistryAddress
    );
    await this.nodeKeyContract.grantRole(await this.nodeKeyContract.OPERATOR_ROLE(), this.rentalContract.target);

    await this.nodeKeyContract.batchMint(this.rentalContract, tokenIds);

    await this.rentalContract.connect(user1).rent(user1, 400n, 1000n, []);
    await this.rentalContract.connect(user1).rent(user1, 401n, 1000n, []);
    await this.rentalContract.connect(user2).rent(user2, 402n, 1000n, []);
    await this.rentalContract.connect(user2).rent(user2, 403n, 10000n, []);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  context('renterOf(uint256 tokenId) view public returns (address)', function () {
    it('Node key never rented', async function () {
      expectRevert(this.rentalContract.renterOf(0n), this.rentalContract, 'NotRented', 0n);
    });

    it('Node key rented', async function () {
      await this.rentalContract.connect(user1).rent(user1, 0n, 10n, []);
      expect(await this.rentalContract.renterOf(0n)).to.be.equal(user1);
    });

    it('Node key rented, and expired', async function () {
      await this.rentalContract.connect(user1).rent(user1, 0n, 10n, []);
      await time.increase(10n);
      expectRevert(this.rentalContract.renterOf(0n), this.rentalContract, 'NotRented', 0n);
    });
  });

  context('estimateFee(uint256 duration, uint256[] calldata expiredNodeKeyIds) public view returns (uint256 fee)', function () {
    it('No any key rented', async function () {
      expect(await this.rentalContract.estimateFee(10n, [])).to.be.equal(10n);
    });

    it('1 node key rented for 1000s.', async function () {
      await this.rentalContract.connect(user1).rent(user1, 0n, 1000n, []);
      expect(await this.rentalContract.estimateFee(1000n, [])).to.be.equal(2n + 1000n * this.monthlyMaintenanceFee);
    });

    it('1 node key rented for 1000s, 1200s elapsed without return, then estimate fee', async function () {
      await this.rentalContract.connect(user1).rent(user1, 0n, 1000n, []);
      await time.increase(1200n);
      expect(await this.rentalContract.estimateFee(1000n, [])).to.be.equal(2n + 1000n * this.monthlyMaintenanceFee);
    });

    it('1 node key rented for 1000s, 1200s elapsed and returned it, then estimate fee', async function () {
      await this.rentalContract.connect(user1).rent(user1, 0n, 1000n, []);
      await time.increase(1200n);
      expect(await this.rentalContract.estimateFee(1000n, [0n])).to.be.equal(1000n * this.monthlyMaintenanceFee);
    });
  });

  context('rent(address account, uint256 tokenId, uint256 duration)', function () {
    it('successfully rent 1 node key', async function () {
      const tx = await this.rentalContract.connect(user1).rent(user1, 0n, 1000n, []);
      const blockTimestamp = await getBlockTimestamp(tx);

      await expect(tx)
        .to.emit(this.ocp, 'Consumed')
        .withArgs(user1, this.rentalReasonCode, this.rentalContract, 1000n * this.monthlyMaintenanceFee)
        .to.emit(this.rentalContract, 'Rental')
        .withArgs(user1, 0n, [blockTimestamp, blockTimestamp + 1000n], 1000n * this.monthlyMaintenanceFee);
    });

    it('rent a non-existence node key', async function () {
      await expect(this.rentalContract.connect(user1).rent(user1, 500n, 10n, []))
        .to.be.revertedWithCustomError(this.nodeKeyContract, 'ERC721NonExistingToken')
        .withArgs(500n);
    });

    it('rent a node key for 0 duration', async function () {
      await expect(this.rentalContract.connect(user1).rent(user1, 0n, 0n, [])).to.be.revertedWithCustomError(
        this.rentalContract,
        'ZeroRentalDuration'
      );
    });

    it('rent a token however signer does not have enough balance to rent', async function () {
      await expect(this.rentalContract.connect(user4).rent(user4, 0n, 10n, []))
        .to.be.revertedWithCustomError(this.ocp, 'InsufficientBalance')
        .withArgs(user4, 10n);
    });

    it('extend the rent on an non-expired node key.', async function () {
      await time.increase(5n);

      await this.rentalContract.connect(user1).rent(user1, 400n, 1000n, []);
      const {endDate} = await this.rentalContract.rentals(400n);

      const tx = await this.rentalContract.connect(user1).rent(user1, 400n, 1000n, []);
      const blockTimestamp = await getBlockTimestamp(tx);

      await expect(tx)
        .to.emit(this.ocp, 'Consumed')
        .withArgs(user1, this.rentalReasonCode, this.rentalContract, 2n + 1000n * this.monthlyMaintenanceFee)
        .to.emit(this.rentalContract, 'Rental')
        .withArgs(user1, 400n, [endDate, endDate + 1000n], 2n + 1000n * this.monthlyMaintenanceFee);
    });

    it('rent non-expired node key from another wallet', async function () {
      await expect(this.rentalContract.connect(user3).rent(user3, 400n, 10n, []))
        .to.be.revertedWithCustomError(this.rentalContract, 'NotRentable')
        .withArgs(400n);
    });

    it('rent an expired node key from another wallet, during grace period', async function () {
      await time.increase(10n);
      await expect(this.rentalContract.connect(user3).rent(user3, 400n, 10n, []))
        .to.be.revertedWithCustomError(this.rentalContract, 'NotRentable')
        .withArgs(400n);
    });

    it('rent an expired node key from another wallet, after grace period', async function () {
      await time.increase(10n + DEFAULT_GRACE_PERIOD);

      const tx = await this.rentalContract.connect(user3).rent(user3, 400n, 10n, []);
      const blockTimestamp = await getBlockTimestamp(tx);

      await expect(tx)
        .to.emit(this.ocp, 'Consumed')
        .withArgs(user3, this.rentalReasonCode, this.rentalContract, 10n)
        .to.emit(this.rentalContract, 'Rental')
        .withArgs(user3, [400n], [[blockTimestamp + 10n, blockTimestamp + 10n + DEFAULT_GRACE_PERIOD, 1n]], [10n]);
    });
  });

  context('collectIdledTokens(uint256[] calldata tokenIds) external', function () {
    it('Successfully collect the idled tokens', async function () {
      await time.increase(10n + DEFAULT_GRACE_PERIOD);
      await expect(this.rentalContract.collectIdledTokens([400n, 401n, 402n]))
        .to.emit(this.nodeKeyContract, 'Transfer')
        .withArgs(user1, this.rentalContract, 400n)
        .to.emit(this.nodeKeyContract, 'Transfer')
        .withArgs(user1, this.rentalContract, 401n)
        .to.emit(this.nodeKeyContract, 'Transfer')
        .withArgs(user2, this.rentalContract, 402n);
    });

    it('Failed to collect tokens since some token is not idled ', async function () {
      await time.increase(10n + DEFAULT_GRACE_PERIOD);
      await expect(this.rentalContract.collectIdledTokens([401n, 403n]))
        .to.be.revertedWithCustomError(this.rentalContract, 'NotCollectable')
        .withArgs(403n);
    });

    it('Failed to collect tokens since some token is never rented ', async function () {
      await time.increase(10n + DEFAULT_GRACE_PERIOD);
      await expect(this.rentalContract.collectIdledTokens([400n, 10n]))
        .to.be.revertedWithCustomError(this.rentalContract, 'NotRented')
        .withArgs(10n);
    });
  });

  context('Meta transaction', function () {
    it('returns the msg.data', async function () {
      await this.rentalContract.__msgData();
    });
  });
});
