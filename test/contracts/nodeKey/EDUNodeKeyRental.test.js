const {ethers} = require('hardhat');
const {expect} = require('chai');
const {expectRevert} = require('@animoca/ethereum-contract-helpers/src/test/revert');
const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {getForwarderRegistryAddress, getTokenMetadataResolverPerTokenAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');
const {time} = require('@nomicfoundation/hardhat-network-helpers');
const keccak256 = require('keccak256');
const { ZeroAddress } = require('ethers');

const DEFAULT_MAINTENANCE_FEE = 1n;

function calculateNodeKeyPrice(totalEffectiveRentalTime) {
  return totalEffectiveRentalTime;
}

function calculateFee(totalEffectiveRentalTime, duration, maintenanceFee = DEFAULT_MAINTENANCE_FEE) {
  return calculateNodeKeyPrice(totalEffectiveRentalTime) + duration * maintenanceFee;
}

function calculateFees(totalEffectiveRentalTime, durations, maintenanceFee = DEFAULT_MAINTENANCE_FEE) {
  const totalNodeKeyPrice = calculateNodeKeyPrice(totalEffectiveRentalTime);
  return durations.map(duration => totalNodeKeyPrice + duration * maintenanceFee);
}

async function getBlockTimestamp(tx) {
  const block = await ethers.provider.getBlock(tx.blockNumber);
  return BigInt(block.timestamp);
}

describe('EDUNodeKeyRental', function () {
  before(async function () {
    [deployer, user1, user2, user3, user4, rentalOperator, other] = await ethers.getSigners();
  });

  const fixture = async function () {
    const metadataResolverAddress = await getTokenMetadataResolverPerTokenAddress();
    const forwarderRegistryAddress = await getForwarderRegistryAddress();

    this.nodeKeyContract = await deployContract('EDUNodeKey', 'EDU Principal Node Key', 'EDUKey', metadataResolverAddress, forwarderRegistryAddress);
    await this.nodeKeyContract.grantRole(await this.nodeKeyContract.OPERATOR_ROLE(), deployer.address);



    this.nodeKeyContractTotalSupply = 5000n;
    this.maxRentalDuration = 5184000n;
    this.maxRentalCountPerCall = 20n;

    const initialOCPAmount = ethers.MaxUint256 / 2n;

    this.ocp = await deployContract('Points', await getForwarderRegistryAddress());
    await this.ocp.grantRole(await this.ocp.DEPOSITOR_ROLE(), deployer);

    const ocpReasonCode = keccak256('TEST');
    await this.ocp.deposit(deployer, initialOCPAmount, ocpReasonCode);
    await this.ocp.deposit(user1, initialOCPAmount, ocpReasonCode);
    await this.ocp.deposit(user2, initialOCPAmount, ocpReasonCode);
    await this.ocp.deposit(user3, initialOCPAmount, ocpReasonCode);

    this.rentalContract = await deployContract(
      'EDUNodeKeyRentalMock',
      this.nodeKeyContract.target,
      this.ocp.target,
      DEFAULT_MAINTENANCE_FEE,
      this.maxRentalDuration,
      this.maxRentalCountPerCall,
      this.nodeKeyContractTotalSupply,
      forwarderRegistryAddress
    );

    this.rentalReasonCode = await this.rentalContract.RENTAL_CONSUME_CODE();

    await this.ocp.grantRole(await this.ocp.ADMIN_ROLE(), deployer);
    await this.ocp.grantRole(await this.ocp.SPENDER_ROLE(), this.rentalContract.target);
    await this.ocp.addConsumeReasonCodes([this.rentalReasonCode]);
    await this.nodeKeyContract.grantRole(await this.nodeKeyContract.OPERATOR_ROLE(), this.rentalContract.target);
    await this.rentalContract.grantRole(await this.rentalContract.OPERATOR_ROLE(), rentalOperator);

    this.initialRentals = [
      {
        account: user1,
        tokenId: 400n,
        duration: 1000n,
      },
      {
        account: user1,
        tokenId: 401n,
        duration: 1000n,
      },
      {
        account: user2,
        tokenId: 402n,
        duration: 1000n,
      },
      {
        account: user2,
        tokenId: 403n,
        duration: 10000n,
      }
    ];

    this.initialRentalsDuration = this.initialRentals.reduce((acc, cur) => acc + cur.duration, 0n);

    for (let i = 0; i < this.initialRentals.length; i++) {
      const rental = this.initialRentals[i];
      await this.rentalContract.connect(rental.account).rent(rental.account, rental.tokenId, rental.duration, []);
    }
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

  context('rent(address account, uint256 tokenId, uint256 duration, uint256[] calldata expiredTokenIds)', function () {
    it('successfully rent 1 collected node key', async function () {
      const tx = await this.rentalContract.connect(user1).rent(user1, 0n, 1000n, []);
      const expectedCost = calculateFee(this.initialRentalsDuration, 1000n);
      const blockTimestamp = await getBlockTimestamp(tx);
      await expect(tx)
        .to.emit(this.ocp, 'Consumed')
        .withArgs(this.rentalContract, this.rentalReasonCode, user1, expectedCost)
        .to.emit(this.rentalContract, 'Rental')
        .withArgs(user1, 0n, [blockTimestamp, blockTimestamp + 1000n], expectedCost);
    });

    it('successfully rent 1 expired node key, it was rented by another account', async function () {
      await this.rentalContract.connect(user2).rent(user2, 0n, 1000n, []);
      await time.increase(2000n);

      const tx = await this.rentalContract.connect(user1).rent(user1, 0n, 1000n, []);
      const expectedCost = calculateFee(this.initialRentalsDuration, 1000n);
      const blockTimestamp = await getBlockTimestamp(tx);

      await expect(tx)
        .to.emit(this.ocp, 'Consumed')
        .withArgs(this.rentalContract, this.rentalReasonCode, user1, expectedCost)
        .to.emit(this.rentalContract, 'Rental')
        .withArgs(user1, 0n, [blockTimestamp, blockTimestamp + 1000n], expectedCost);
    });

    it('successfully rent 1 expired node key, it was rented by another account. With collecting all expired tokens', async function () {
      await this.rentalContract.connect(user2).rent(user2, 0n, 1000n, []);
      await time.increase(2000n);

      const tx = await this.rentalContract.connect(user1).rent(user1, 0n, 1000n, [400n, 401n, 402n]);
      const expectedCost = calculateFee(10000n, 1000n);
      const blockTimestamp = await getBlockTimestamp(tx);

      await expect(tx)
        .to.emit(this.ocp, 'Consumed')
        .withArgs(this.rentalContract, this.rentalReasonCode, user1, expectedCost)
        .to.emit(this.rentalContract, 'Rental')
        .withArgs(user1, 0n, [blockTimestamp, blockTimestamp + 1000n], expectedCost);
    });

    it('rent a node key that reaches the token supply', async function () {
      await expect(this.rentalContract.connect(user1).rent(user1, this.nodeKeyContractTotalSupply, 1000n, [])).to.be.revertedWithCustomError(
        this.rentalContract,
        'UnsupportedTokenId'
      ).withArgs(this.nodeKeyContractTotalSupply);
    });

    it('rent a node key for 0 duration', async function () {
      await expect(this.rentalContract.connect(user1).rent(user1, 0n, 0n, [])).to.be.revertedWithCustomError(
        this.rentalContract,
        'ZeroRentalDuration'
      ).withArgs(0n);
    });

    it('rent a node key for a duration that reaches the maximum rental duration', async function () {
      await expect(this.rentalContract.connect(user1).rent(user1, 0n, this.maxRentalDuration + 1n, [])).to.be.revertedWithCustomError(
        this.rentalContract,
        'RentalDurationLimitExceeded'
      ).withArgs(0n, this.maxRentalDuration + 1n);
    });

    it('rent a token however signer does not have enough balance to rent', async function () {
      await expect(this.rentalContract.connect(user4).rent(user4, 0n, 2000n, []))
        .to.be.revertedWithCustomError(this.ocp, 'InsufficientBalance')
        .withArgs(user4, 15000n);
    });

    it('extend the rental on an non-expired node key.', async function () {
      // rent for 1000s initially
      const tx1 = await this.rentalContract.connect(user1).rent(user1, 0n, 1000n, []);
      const blockTimestamp1 = await getBlockTimestamp(tx1);
      await time.increase(200n);

      // extend the rental for 500s
      const tx2 = await this.rentalContract.connect(user1).rent(user1, 0n, 500n, []);
      const blockTimestamp2 = await getBlockTimestamp(tx2);

      const expectedCost = calculateFee(this.initialRentalsDuration + 1000n - (blockTimestamp2 - blockTimestamp1), 500n);
      await expect(tx2)
        .to.emit(this.ocp, 'Consumed')
        .withArgs(this.rentalContract, this.rentalReasonCode, user1, expectedCost)
        .to.emit(this.rentalContract, 'Rental')
        .withArgs(user1, 0n, [blockTimestamp2, blockTimestamp1 + 1000n + 500n], expectedCost);
    });

    it('rent non-expired node key from another wallet', async function () {
      await expect(this.rentalContract.connect(user3).rent(user3, 400n, 10n, []))
        .to.be.revertedWithCustomError(this.rentalContract, 'NotRentable')
        .withArgs(400n);
    });
  });

  context('batchRent(address account, uint256[] calldata tokenIds, uint256[] calldata durations, uint256[] calldata expiredTokenIds) public', function () {
    it('successfully rent 1 collected node key', async function () {
      const tx = await this.rentalContract.connect(user1).batchRent(user1, [0n], [1000n], []);
      const expectedCosts = calculateFees(this.initialRentalsDuration, [1000n]);
      const blockTimestamp = await getBlockTimestamp(tx);
      await expect(tx)
        .to.emit(this.ocp, 'Consumed')
        .withArgs(this.rentalContract, this.rentalReasonCode, user1, expectedCosts.reduce((acc, cost) => acc + cost, 0n))
        .to.emit(this.rentalContract, 'BatchRental')
        .withArgs(user1, [0n], [[blockTimestamp, blockTimestamp + 1000n]], expectedCosts);
    });

    it('successfully rent 2 collected node key', async function () {
      const tx = await this.rentalContract.connect(user1).batchRent(user1, [0n, 1n], [1000n, 2000n], []);
      const expectedCosts = calculateFees(this.initialRentalsDuration, [1000n, 2000n]);
      const blockTimestamp = await getBlockTimestamp(tx);
      await expect(tx)
        .to.emit(this.ocp, 'Consumed')
        .withArgs(this.rentalContract, this.rentalReasonCode, user1, expectedCosts.reduce((acc, cost) => acc + cost, 0n))
        .to.emit(this.rentalContract, 'BatchRental')
        .withArgs(user1, [0n, 1n], [[blockTimestamp, blockTimestamp + 1000n], [blockTimestamp, blockTimestamp + 2000n]], expectedCosts);
    });

    it('one of the tokenId that reaches the token supply', async function () {
      await expect(this.rentalContract.connect(user1).batchRent(user1, [0n, this.nodeKeyContractTotalSupply], [1000n, 2000n], [])).to.be.revertedWithCustomError(
        this.rentalContract,
        'UnsupportedTokenId'
      ).withArgs(this.nodeKeyContractTotalSupply);
    });

    it('incon', async function () {
      await expect(this.rentalContract.connect(user1).batchRent(user1, [0n, this.nodeKeyContractTotalSupply], [1000n, 2000n], [])).to.be.revertedWithCustomError(
        this.rentalContract,
        'UnsupportedTokenId'
      ).withArgs(this.nodeKeyContractTotalSupply);
    });
  });

  context('collectExpiredTokens(uint256[] calldata tokenIds) external', function () {
    it('Successfully collect the idled tokens', async function () {
      await time.increase(1000n);
      await expect(this.rentalContract.collectExpiredTokens([400n, 401n, 402n]))
        .to.emit(this.nodeKeyContract, 'Transfer')
        .withArgs(user1, ZeroAddress, 400n)
        .to.emit(this.nodeKeyContract, 'Transfer')
        .withArgs(user1, ZeroAddress, 401n)
        .to.emit(this.nodeKeyContract, 'Transfer')
        .withArgs(user2, ZeroAddress, 402n);
    });

    it('Failed to collect tokens since some token is not expired', async function () {
      await time.increase(1000n);
      await expect(this.rentalContract.collectExpiredTokens([401n, 403n]))
      .to.be.revertedWithCustomError(this.rentalContract, 'TokenNotExpired')
        .withArgs(403n);
    });

    it('Failed to collect tokens since some token is never rented ', async function () {
      await time.increase(1000n);
      await expect(this.rentalContract.collectExpiredTokens([400n, 10n]))
        .to.be.revertedWithCustomError(this.rentalContract, 'TokenNotExpired')
        .withArgs(10n);
    });
  });

  context('estimateRentalFee(address account, uint256 tokenId, uint256 duration, uint256[] calldata expiredTokenIds) public view returns (uint256 fee)', function () {
    it('rent a clean token', async function () {
      const expectedCost = calculateFee(this.initialRentalsDuration, 1000n);
      expect(await this.rentalContract.estimateRentalFee(user1, 20n, 1000n, [])).equal(expectedCost);
    });

    it('rent a token that has expired', async function () {
      await time.increase(1000n);
      const expectedCost = calculateFee(this.initialRentalsDuration - 1000n, 1000n);
      expect(await this.rentalContract.estimateRentalFee(user1, 400n, 1000n, [])).equal(expectedCost);
    });

    it('extend a token', async function () {
      await this.rentalContract.connect(user1).rent(user1, 10n, 1000n, []);
      await time.increase(500n);
      const expectedCost = calculateFee(this.initialRentalsDuration + 1000n - 500n, 1000n);
      expect(await this.rentalContract.estimateRentalFee(user1, 10n, 1000n, [])).equal(expectedCost);
    });

    it('extend a token, while renting 2 expired tokens', async function () {
      await this.rentalContract.connect(user1).rent(user1, 10n, 2000n, []);
      await time.increase(1500n);
      const expectedCost = calculateFee(this.initialRentalsDuration + 2000n - 1500n - 2n * 1000n, 1000n);
      expect(await this.rentalContract.estimateRentalFee(user1, 10n, 1000n, [400n, 401n])).equal(expectedCost);
    });

    it('rent a token that is currently rented by another account', async function () {
      await expect(this.rentalContract.estimateRentalFee(user1, 403n, 1000n, []))
      .to.be.revertedWithCustomError(this.rentalContract, 'NotRentable')
      .withArgs(403n);
    });

    it('rent a token that has expired, while collecting 2 other tokens', async function () {
      await time.increase(1000n);
      const expectedCost = calculateFee(10000n, 1000n);
      expect(await this.rentalContract.estimateRentalFee(user1, 400n, 1000n, [401n, 402n])).equal(expectedCost);
    });

    it('rent a token that has expired, while collecting 2 other tokens + include the token to be rented in expiredTokenIds too', async function () {
      await time.increase(1000n);
      const expectedCost = calculateFee(9000n, 1000n);
      expect(await this.rentalContract.estimateRentalFee(user1, 400n, 1000n, [400n, 401n, 402n])).equal(expectedCost);
    });
  });

  context('calculateElapsedTimeForExpiredTokens(uint256[] calldata tokenIds) public view returns (uint256 elapsedTime)', function () {
    it('Empty expired tokenIds array', async function () {
      expect(await this.rentalContract.calculateElapsedTimeForExpiredTokens([])).equal(0);
    });

    it('2 expired tokens were passed', async function () {
      await time.increase(1000n);
      expect(await this.rentalContract.calculateElapsedTimeForExpiredTokens([400n, 402n])).equal(2000n);
    });

    it('3 expired tokens were passed', async function () {
      await time.increase(1000n);
      expect(await this.rentalContract.calculateElapsedTimeForExpiredTokens([400n, 401n, 402n])).equal(3000n);
    });

    it('4 expired tokens were passed', async function () {
      await time.increase(10000n);
      expect(await this.rentalContract.calculateElapsedTimeForExpiredTokens([400n, 401n, 402n, 403n])).equal(13000n);
    });

    it('Some tokenId has not rented', async function () {
      await expect(this.rentalContract.calculateElapsedTimeForExpiredTokens([12n]))
        .to.be.revertedWithCustomError(this.rentalContract, 'NotRented')
        .withArgs(12n);
    });

    it('Some tokenId has not expired', async function () {
      await expect(this.rentalContract.calculateElapsedTimeForExpiredTokens([400n]))
        .to.be.revertedWithCustomError(this.rentalContract, 'TokenNotExpired')
        .withArgs(400n);
    });

    it('1st token has not rented, 2nd token has not expired', async function () {
      await expect(this.rentalContract.calculateElapsedTimeForExpiredTokens([400n, 12n]))
        .to.be.revertedWithCustomError(this.rentalContract, 'TokenNotExpired')
        .withArgs(400n);
    });

    it('1st token has not expired, 2nd token has not rented', async function () {
      await expect(this.rentalContract.calculateElapsedTimeForExpiredTokens([12n, 400n]))
        .to.be.revertedWithCustomError(this.rentalContract, 'NotRented')
        .withArgs(12n);
    });

    it('4 tokens passed, only 3 tokens expired', async function () {
      await time.increase(1000n);
      await expect(this.rentalContract.calculateElapsedTimeForExpiredTokens([400n, 401n, 402n, 403n]))
      .to.be.revertedWithCustomError(this.rentalContract, 'TokenNotExpired')
      .withArgs(403n);
    });
  })

  context('setMonthlyMaintenanceFee(uint256 newMonthlyMaintenanceFee) external', function () {
    it('Success', async function () {
      await expect(this.rentalContract.connect(rentalOperator).setMonthlyMaintenanceFee(2n))
        .to.emit(this.rentalContract, 'MonthlyMaintenanceFeeUpdated')
        .withArgs(2n)
    });

    it('Failure because it set by non operator wallet', async function () {
      await expect(this.rentalContract.connect(user1).setMonthlyMaintenanceFee(2n))
        .to.be.revertedWithCustomError(this.rentalContract, 'NotRoleHolder')
        .withArgs(await this.nodeKeyContract.OPERATOR_ROLE(), user1);
    });
  });

  context('setMaxRentalDuration(uint256 newMaxRentalDuration) external', function () {
    it('Success', async function () {
      await expect(this.rentalContract.connect(rentalOperator).setMaxRentalDuration(1000n))
        .to.emit(this.rentalContract, 'MaxRentalDurationUpdated')
        .withArgs(1000n)
    });

    it('Failure because it set by non operator wallet', async function () {
      await expect(this.rentalContract.connect(user1).setMaxRentalDuration(1000n))
        .to.be.revertedWithCustomError(this.rentalContract, 'NotRoleHolder')
        .withArgs(await this.nodeKeyContract.OPERATOR_ROLE(), user1);
    });
  });

  context('setMaxRentalCountPerCall(uint256 newRentalCountPerCall) external', function () {
    it('Success', async function () {
      await expect(this.rentalContract.connect(rentalOperator).setMaxRentalCountPerCall(300n))
        .to.emit(this.rentalContract, 'MaxRentalCountPerCallUpdated')
        .withArgs(300n)
    });

    it('Failure because it set by non operator wallet', async function () {
      await expect(this.rentalContract.connect(user1).setMaxRentalCountPerCall(300n))
        .to.be.revertedWithCustomError(this.rentalContract, 'NotRoleHolder')
        .withArgs(await this.nodeKeyContract.OPERATOR_ROLE(), user1);
    });
  });

  context('Meta transaction', function () {
    it('returns the msg.data', async function () {
      await this.rentalContract.__msgData();
    });
  });
});
