const {ethers} = require('hardhat');
const {expect} = require('chai');
const {expectRevert} = require('@animoca/ethereum-contract-helpers/src/test/revert');
const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {getForwarderRegistryAddress, deployTokenMetadataResolverWithBaseURI} = require('@animoca/ethereum-contracts/test/helpers/registries');
const {time} = require('@nomicfoundation/hardhat-network-helpers');
const keccak256 = require('keccak256');
const {ZeroAddress} = require('ethers');

const DEFAULT_MAINTENANCE_FEE = 1n;
const DEFAULT_MAINTENANCE_FEE_DENOMINATOR = 1n;

function bigIntLog2(n) {
  if (n <= 0n) {
    throw new Error('Input must be greater than zero');
  }

  let result = 0n;
  let x = n;

  // Use bit shifting to find log2(n)
  while (x > 1n) {
    x >>= 1n; // Divide by 2 using bitwise shift
    result++;
  }

  return result;
}

const DIVIDER = 100n;
const STARTING_PRICE = 500n;
const MIN_PRICE = 5000n;
function calculateNodeKeyPrice(totalEffectiveRentalTime) {
  const val = bigIntLog2(totalEffectiveRentalTime / DIVIDER) * STARTING_PRICE;
  return val > MIN_PRICE ? val : MIN_PRICE;
}

const RENTAL_TYPE = {
  CLEAN: 0,
  EXTENSION: 1,
};
function calculateFees(
  totalEffectiveRentalTime,
  durations,
  types,
  maintenanceFee = DEFAULT_MAINTENANCE_FEE,
  maintenanceFeeDenominator = DEFAULT_MAINTENANCE_FEE_DENOMINATOR
) {
  const totalNodeKeyPrice = calculateNodeKeyPrice(totalEffectiveRentalTime);
  return durations.map((duration, i) => {
    if (types[i] == null) throw new Error('calculateFees: Rental type must not be null.');
    if (types[i] === RENTAL_TYPE.EXTENSION) return (duration * maintenanceFee) / maintenanceFeeDenominator;
    return totalNodeKeyPrice + (duration * maintenanceFee) / maintenanceFeeDenominator;
  });
}

async function getBlockTimestamp(tx) {
  const block = await ethers.provider.getBlock(tx.blockNumber);
  return BigInt(block.timestamp);
}

describe('EDULandRental', function () {
  before(async function () {
    [deployer, user1, user2, user3, user4, rentalOperator, other] = await ethers.getSigners();
  });

  const fixture = async function () {
    const metadataResolverAddress = await deployTokenMetadataResolverWithBaseURI();
    const forwarderRegistryAddress = await getForwarderRegistryAddress();

    this.nodeKeyContract = await deployContract('EDULand', 'EDU Land', 'EDULand', metadataResolverAddress);
    await this.nodeKeyContract.grantRole(await this.nodeKeyContract.OPERATOR_ROLE(), deployer.address);

    this.nodeKeyContractTotalSupply = 5000n;
    this.minRentalDuration = 1n;
    this.maxRentalDuration = 5184000n;
    this.maxRentalCountPerCall = 20n;

    const initialOCPAmount = ethers.MaxUint256 / 2n;

    this.ocp = await deployContract('Points', forwarderRegistryAddress);
    await this.ocp.grantRole(await this.ocp.DEPOSITOR_ROLE(), deployer);

    const ocpReasonCode = keccak256('TEST');
    await this.ocp.deposit(deployer, initialOCPAmount, ocpReasonCode);
    await this.ocp.deposit(user1, initialOCPAmount, ocpReasonCode);
    await this.ocp.deposit(user2, initialOCPAmount, ocpReasonCode);
    await this.ocp.deposit(user3, initialOCPAmount, ocpReasonCode);

    this.rentalFeeHelper = await deployContract('EDULandPriceHelper');
    this.rentalContract = await deployContract(
      'EDULandRentalMock',
      this.nodeKeyContract.target,
      this.ocp.target,
      this.rentalFeeHelper.target,
      DEFAULT_MAINTENANCE_FEE,
      DEFAULT_MAINTENANCE_FEE_DENOMINATOR,
      this.minRentalDuration,
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
      },
    ];

    this.initialRentalsDuration = this.initialRentals.reduce((acc, cur) => acc + cur.duration, 0n);

    for (let i = 0; i < this.initialRentals.length; i++) {
      const rental = this.initialRentals[i];
      await this.rentalContract.connect(rental.account).rent(rental.account, [rental.tokenId], [rental.duration], [], 0n);
    }
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  context('renterOf(uint256 tokenId) public view returns (address)', function () {
    it('Node key never rented', async function () {
      expectRevert(this.rentalContract.renterOf(1n), this.rentalContract, 'TokenNotRented', 1n);
    });

    it('Node key rented', async function () {
      await this.rentalContract.connect(user1).rent(user1, [1n], [10n], [], 0n);
      expect(await this.rentalContract.renterOf(1n)).to.be.equal(user1);
    });

    it('Node key rented, and expired', async function () {
      await this.rentalContract.connect(user1).rent(user1, [1n], [10n], [], 0n);
      await time.increase(10n);
      expectRevert(this.rentalContract.renterOf(1n), this.rentalContract, 'TokenNotRented', 1n);
    });
  });

  context(
    `rent(
      address account,
      uint256[] calldata tokenIds,
      uint256[] calldata durations,
      uint256[] calldata expiredTokenIds,
      uint256 maxFee
    ) public`,
    function () {
      it('reverts if rent more than max rental count per call', async function () {
        const tokenIds = [];
        for (let i = 0n; i < this.maxRentalCountPerCall + 1n; i += 1n) {
          tokenIds.push(i + 1n);
        }
        const durations = tokenIds.map((_) => 1000n);
        await expect(this.rentalContract.connect(user1).rent(user1, tokenIds, durations, [], 0n)).to.be.revertedWithCustomError(
          this.rentalContract,
          'RentalCountPerCallLimitExceeded'
        );
      });

      it('reverts if tokenIds and durations length mismatch', async function () {
        await expect(this.rentalContract.connect(user1).rent(user1, [1n], [1000n, 2000n], [], 0n)).to.be.revertedWithCustomError(
          this.rentalContract,
          'InconsistentArrayLengths'
        );
      });

      it('one of the tokenId is 0', async function () {
        await expect(this.rentalContract.connect(user1).rent(user1, [1n, 0n], [1000n, 2000n], [], 0n))
          .to.be.revertedWithCustomError(this.rentalContract, 'UnsupportedTokenId')
          .withArgs(0n);
      });

      it('one of the tokenId that reaches the token supply', async function () {
        await expect(this.rentalContract.connect(user1).rent(user1, [1n, this.nodeKeyContractTotalSupply], [1000n, 2000n], [], 0n))
          .to.be.revertedWithCustomError(this.rentalContract, 'UnsupportedTokenId')
          .withArgs(this.nodeKeyContractTotalSupply);
      });

      it('one of the tokenIds is lower than the minium duration', async function () {
        await expect(this.rentalContract.connect(user1).rent(user1, [1n, 2n], [this.minRentalDuration - 1n, 1000n], [], 0n))
          .to.be.revertedWithCustomError(this.rentalContract, 'RentalDurationTooLow')
          .withArgs(1n, this.minRentalDuration - 1n, this.minRentalDuration);
      });

      it('one of the tokenIds reaches the maximum rental duration', async function () {
        await expect(this.rentalContract.connect(user1).rent(user1, [2n, 1n], [1000n, this.maxRentalDuration + 1n], [], 0n))
          .to.be.revertedWithCustomError(this.rentalContract, 'RentalDurationTooHigh')
          .withArgs(1n, this.maxRentalDuration + 1n, this.maxRentalDuration);
      });

      it('the total rental duration of one of the tokenIds to extend reaches the maximum rental duration', async function () {
        const tx = await this.rentalContract.connect(user1).rent(user1, [1n], [this.maxRentalDuration], [], 0n);
        const blockTimestamp = await getBlockTimestamp(tx);
        await time.setNextBlockTimestamp(blockTimestamp + 200n);
        await expect(this.rentalContract.connect(user1).rent(user1, [2n, 1n], [1000n, 300n], [], 0n))
          .to.be.revertedWithCustomError(this.rentalContract, 'RentalDurationTooHigh')
          .withArgs(1n, 300n, 200n);
      });

      it('one of the tokenIds is non-expired node key from another wallet', async function () {
        await expect(this.rentalContract.connect(user1).rent(user1, [1n, 403n], [1000n, 2000n], [], 0n))
          .to.be.revertedWithCustomError(this.rentalContract, 'TokenAlreadyRented')
          .withArgs(403n);
      });

      it('one of the tokenIds is expired and rented by another account, not being supplied to expiredTokenIds', async function () {
        await this.rentalContract.connect(user2).rent(user2, [1n], [1000n], [], 0n);
        await time.increase(1000n);

        await expect(this.rentalContract.connect(user1).rent(user1, [1n, 2n], [1000n, 50n], [], 0n))
          .to.be.revertedWithCustomError(this.rentalContract, 'TokenAlreadyRented')
          .withArgs(1n);
      });

      it('one of the tokenIds is expired, not being supplied to expiredTokenIds', async function () {
        await this.rentalContract.connect(user2).rent(user2, [1n], [1000n], [], 0n);
        await time.increase(1000n);

        await expect(this.rentalContract.connect(user2).rent(user2, [1n, 2n], [1000n, 50n], [], 0n))
          .to.be.revertedWithCustomError(this.rentalContract, 'TokenAlreadyRented')
          .withArgs(1n);
      });

      it('signer does not have enough balance to rent', async function () {
        const expectedCosts = calculateFees(this.initialRentalsDuration, [2000n, 1000n], [RENTAL_TYPE.CLEAN, RENTAL_TYPE.CLEAN]);
        await expect(this.rentalContract.connect(user4).rent(user4, [1n, 2n], [2000n, 1000n], [], 0n))
          .to.be.revertedWithCustomError(this.ocp, 'InsufficientBalance')
          .withArgs(
            user4,
            expectedCosts.reduce((acc, cost) => acc + cost, 0n)
          );
      });

      it('the fee is higher than the maxFee', async function () {
        const fee = calculateFees(this.initialRentalsDuration, [1000n, 1000n], [RENTAL_TYPE.CLEAN, RENTAL_TYPE.CLEAN]).reduce(
          (acc, cost) => acc + cost,
          0n
        );
        const maxFee = fee - 1n;
        await expect(this.rentalContract.connect(user1).rent(user1, [1n, 2n], [1000n, 1000n], [], maxFee))
          .to.be.revertedWithCustomError(this.rentalContract, 'FeeExceeded')
          .withArgs(fee, maxFee);
      });

      context('when successful', function () {
        it('successfully rent 1 clean node key', async function () {
          const tx = await this.rentalContract.connect(user1).rent(user1, [1n], [this.minRentalDuration], [], 0n);
          const expectedCost = calculateFees(this.initialRentalsDuration, [this.minRentalDuration], [RENTAL_TYPE.CLEAN]).reduce(
            (acc, cost) => acc + cost,
            0n
          );
          const blockTimestamp = await getBlockTimestamp(tx);
          await expect(tx)
            .to.emit(this.ocp, 'Consumed')
            .withArgs(this.rentalContract, this.rentalReasonCode, user1, expectedCost)
            .to.emit(this.rentalContract, 'Rental')
            .withArgs(user1, [1n], [[blockTimestamp, blockTimestamp + this.minRentalDuration, expectedCost]]);
        });

        it('successfully rent 1 clean node key that being paid by another account', async function () {
          const tx = await this.rentalContract.connect(user2).rent(user1, [1n], [1000n], [], 0n);
          const expectedCost = calculateFees(this.initialRentalsDuration, [1000n], [RENTAL_TYPE.CLEAN]).reduce((acc, cost) => acc + cost, 0n);
          const blockTimestamp = await getBlockTimestamp(tx);
          await expect(tx)
            .to.emit(this.ocp, 'Consumed')
            .withArgs(this.rentalContract, this.rentalReasonCode, user2, expectedCost)
            .to.emit(this.rentalContract, 'Rental')
            .withArgs(user1, [1n], [[blockTimestamp, blockTimestamp + 1000n, expectedCost]]);
        });

        it('successfully rent 2 clean node key', async function () {
          const tx = await this.rentalContract.connect(user1).rent(user1, [1n, 2n], [1000n, 2000n], [], 0n);
          const expectedCosts = calculateFees(this.initialRentalsDuration, [1000n, 2000n], [RENTAL_TYPE.CLEAN, RENTAL_TYPE.CLEAN]);
          const blockTimestamp = await getBlockTimestamp(tx);
          await expect(tx)
            .to.emit(this.ocp, 'Consumed')
            .withArgs(
              this.rentalContract,
              this.rentalReasonCode,
              user1,
              expectedCosts.reduce((acc, cost) => acc + cost, 0n)
            )
            .to.emit(this.rentalContract, 'Rental')
            .withArgs(
              user1,
              [1n, 2n],
              [
                [blockTimestamp, blockTimestamp + 1000n, expectedCosts[0]],
                [blockTimestamp, blockTimestamp + 2000n, expectedCosts[1]],
              ]
            );
        });

        it('successfully rent 2 node keys; 1 clean node key, and extend the rental on an non-expired node key.', async function () {
          // rent 0n for 1000s initially
          const tx1 = await this.rentalContract.connect(user1).rent(user1, [1n], [1000n], [], 0n);
          const blockTimestamp1 = await getBlockTimestamp(tx1);
          const initialRentCost = calculateFees(this.initialRentalsDuration, [1000n], [RENTAL_TYPE.CLEAN])[0];
          await time.increase(200n);

          // extend 0n for 500s, and rent 1n for 1000s
          const tx2 = await this.rentalContract.connect(user1).rent(user1, [1n, 2n], [200n, 1000n], [], 0n);
          const blockTimestamp2 = await getBlockTimestamp(tx2);
          const expectedCosts = calculateFees(this.initialRentalsDuration + 1000n, [200n, 1000n], [RENTAL_TYPE.EXTENSION, RENTAL_TYPE.CLEAN]);

          await expect(tx2)
            .to.emit(this.ocp, 'Consumed')
            .withArgs(
              this.rentalContract,
              this.rentalReasonCode,
              user1,
              expectedCosts.reduce((acc, cost) => acc + cost, 0n) // NOTE: Consumed event only considers the extension cost
            )
            .to.emit(this.rentalContract, 'Rental')
            .withArgs(
              user1,
              [1n, 2n],
              [
                // NOTE: the rental info struct includes the initial rental + the extension
                [blockTimestamp1, blockTimestamp1 + 1000n + 200n, initialRentCost + expectedCosts[0]],
                [blockTimestamp2, blockTimestamp2 + 1000n, expectedCosts[1]],
              ]
            );
        });

        it('successfully rent 2 node keys; 1 clean node key, and extend the rental on an expired node key.', async function () {
          await this.rentalContract.connect(user1).rent(user1, [1n], [1000n], [], 0n);
          await time.increase(1000n);

          const tx = await this.rentalContract.connect(user1).rent(user1, [1n, 2n], [1000n, 50n], [1n], 0n);
          const expectedCosts = calculateFees(this.initialRentalsDuration, [1000n, 50n], [RENTAL_TYPE.CLEAN, RENTAL_TYPE.CLEAN]);
          const blockTimestamp = await getBlockTimestamp(tx);

          await expect(tx)
            .to.emit(this.ocp, 'Consumed')
            .withArgs(
              this.rentalContract,
              this.rentalReasonCode,
              user1,
              expectedCosts.reduce((acc, cost) => acc + cost, 0n)
            )
            .to.emit(this.rentalContract, 'Rental')
            .withArgs(
              user1,
              [1n, 2n],
              [
                [blockTimestamp, blockTimestamp + 1000n, expectedCosts[0]],
                [blockTimestamp, blockTimestamp + 50n, expectedCosts[1]],
              ]
            );
        });

        it('successfully rent 2 node keys; 1 clean node key, another is expired node key that rented by another account', async function () {
          await this.rentalContract.connect(user2).rent(user2, [1n], [1000n], [], 0n);
          await time.increase(1000n);

          const tx = await this.rentalContract.connect(user1).rent(user1, [1n, 2n], [1000n, 50n], [1n], 0n);
          const expectedCosts = calculateFees(this.initialRentalsDuration, [1000n, 50n], [RENTAL_TYPE.CLEAN, RENTAL_TYPE.CLEAN]);
          const blockTimestamp = await getBlockTimestamp(tx);

          await expect(tx)
            .to.emit(this.ocp, 'Consumed')
            .withArgs(
              this.rentalContract,
              this.rentalReasonCode,
              user1,
              expectedCosts.reduce((acc, cost) => acc + cost, 0n)
            )
            .to.emit(this.rentalContract, 'Rental')
            .withArgs(
              user1,
              [1n, 2n],
              [
                [blockTimestamp, blockTimestamp + 1000n, expectedCosts[0]],
                [blockTimestamp, blockTimestamp + 50n, expectedCosts[1]],
              ]
            );
        });

        it(`successfully rent 2 node keys;
            1 clean node key, another was rented by another account and expired. With collecting all expired tokens`, async function () {
          await this.rentalContract.connect(user2).rent(user2, [1n], [1000n], [], 0n);
          await time.increase(2000n);

          const tx = await this.rentalContract.connect(user1).rent(user1, [1n, 2n], [1000n, 50n], [1n, 400n, 401n, 402n], 0n);
          const expiredTokensTime = 1000n + 1000n + 1000n;
          const expectedCosts = calculateFees(this.initialRentalsDuration - expiredTokensTime, [1000n, 50n], [RENTAL_TYPE.CLEAN, RENTAL_TYPE.CLEAN]);
          const blockTimestamp = await getBlockTimestamp(tx);

          await expect(tx)
            .to.emit(this.ocp, 'Consumed')
            .withArgs(
              this.rentalContract,
              this.rentalReasonCode,
              user1,
              expectedCosts.reduce((acc, cost) => acc + cost, 0n)
            )
            .to.emit(this.rentalContract, 'Rental')
            .withArgs(
              user1,
              [1n, 2n],
              [
                [blockTimestamp, blockTimestamp + 1000n, expectedCosts[0]],
                [blockTimestamp, blockTimestamp + 50n, expectedCosts[1]],
              ]
            )
            .to.emit(this.rentalContract, 'Collected')
            .withArgs([1n, 400n, 401n, 402n]);
        });
      });
    }
  );

  context('collectExpiredTokens(uint256[] calldata tokenIds) public', function () {
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

  context(
    `estimateRentalFee(
      address account,
      uint256[] calldata tokenIds,
      uint256[] calldata durations,
      uint256[] calldata expiredTokenIds
    ) public view returns (uint256 fee)
    `,
    function () {
      it('revert if rent more than max rental count per call', async function () {
        const tokenIds = [];
        for (let i = 0n; i < this.maxRentalCountPerCall + 1n; i += 1n) {
          const id = i + 1n;
          tokenIds.push(id);
        }
        const durations = tokenIds.map((_) => 1000n);
        await expect(this.rentalContract.estimateRentalFee(user1, tokenIds, durations, [])).to.be.revertedWithCustomError(
          this.rentalContract,
          'RentalCountPerCallLimitExceeded'
        );
      });

      it('revert if tokenIds and durations length mismatch', async function () {
        await expect(this.rentalContract.estimateRentalFee(user1, [1n], [1000n, 2000n], [])).to.be.revertedWithCustomError(
          this.rentalContract,
          'InconsistentArrayLengths'
        );
      });

      it('one of the tokenId that reaches the token supply', async function () {
        await expect(this.rentalContract.estimateRentalFee(user1, [1n, this.nodeKeyContractTotalSupply], [1000n, 2000n], []))
          .to.be.revertedWithCustomError(this.rentalContract, 'UnsupportedTokenId')
          .withArgs(this.nodeKeyContractTotalSupply);
      });

      it('one of the tokenIds has 0 duration', async function () {
        await expect(this.rentalContract.estimateRentalFee(user1, [1n, 2n], [this.minRentalDuration - 1n, 1000n], []))
          .to.be.revertedWithCustomError(this.rentalContract, 'RentalDurationTooLow')
          .withArgs(1n, this.minRentalDuration - 1n, this.minRentalDuration);
      });

      it('one of the tokenId is 0', async function () {
        await expect(this.rentalContract.estimateRentalFee(user1, [1n, 0n], [1000n, 1000n], []))
          .to.be.revertedWithCustomError(this.rentalContract, 'UnsupportedTokenId')
          .withArgs(0n);
      });

      it(`rent 2 tokens; one is clean token,
        one of the tokens rented by another account has expired and supply it as expiredTokenIds`, async function () {
        await time.increase(1000n);
        await expect(this.rentalContract.estimateRentalFee(user2, [20n, 400n], [50, 1000n], [400n]))
          .to.be.revertedWithCustomError(this.rentalContract, 'TokenAlreadyRented')
          .withArgs(400n);
      });

      it(`rent 2 tokens; one is clean token,
      one of the tokens rented by another account has expired and not supply it as expiredTokenIds`, async function () {
        await time.increase(1000n);
        await expect(this.rentalContract.estimateRentalFee(user2, [20n, 400n], [50, 1000n], []))
          .to.be.revertedWithCustomError(this.rentalContract, 'TokenAlreadyRented')
          .withArgs(400n);
      });

      it('rent 2 tokens; one is clean token, one of the tokens has expired and supply it as expiredTokenIds', async function () {
        await time.increase(1000n);
        await expect(this.rentalContract.estimateRentalFee(user1, [20n, 400n], [50, 1000n], [400n]))
          .to.be.revertedWithCustomError(this.rentalContract, 'TokenAlreadyRented')
          .withArgs(400n);
      });

      it('rent 2 tokens; one is clean token, one of the tokens has expired and not supply it as expiredTokenIds', async function () {
        await time.increase(1000n);
        await expect(this.rentalContract.estimateRentalFee(user1, [20n, 400n], [50, 1000n], []))
          .to.be.revertedWithCustomError(this.rentalContract, 'TokenAlreadyRented')
          .withArgs(400n);
      });

      it('rent 2 tokens; one is clean token, another token is currently rented by another account', async function () {
        await expect(this.rentalContract.estimateRentalFee(user1, [1n, 403n], [50n, 1000n], []))
          .to.be.revertedWithCustomError(this.rentalContract, 'TokenAlreadyRented')
          .withArgs(403n);
      });

      it('rent 2 tokens; one is clean token, another token reaches the maximum rental duration', async function () {
        await expect(this.rentalContract.estimateRentalFee(user1, [1n, 2n], [1000n, this.maxRentalDuration + 1n], []))
          .to.be.revertedWithCustomError(this.rentalContract, 'RentalDurationTooHigh')
          .withArgs(2n, this.maxRentalDuration + 1n, this.maxRentalDuration);
      });

      it('rent 2 tokens; one is clean token, another token to extend reaches the maximum rental duration', async function () {
        await this.rentalContract.connect(user1).rent(user1, [1n], [this.maxRentalDuration], [], 0n);
        await time.increase(200n);

        await expect(this.rentalContract.estimateRentalFee(user1, [2n, 1n], [1000n, 300n], []))
          .to.be.revertedWithCustomError(this.rentalContract, 'RentalDurationTooHigh')
          .withArgs(1n, 300n, 200n);
      });

      context('when successful', function () {
        it('rent a clean token', async function () {
          const expectedCosts = calculateFees(this.initialRentalsDuration, [1000n], [RENTAL_TYPE.CLEAN]);
          expect(await this.rentalContract.estimateRentalFee(user1, [20n], [1000n], [])).equal(expectedCosts.reduce((acc, cost) => acc + cost, 0n));
        });

        it('rent 2 clean tokens', async function () {
          const expectedCosts = calculateFees(this.initialRentalsDuration, [1000n, 50n], [RENTAL_TYPE.CLEAN, RENTAL_TYPE.CLEAN]);
          expect(await this.rentalContract.estimateRentalFee(user1, [20n, 21n], [1000n, 50n], [])).equal(
            expectedCosts.reduce((acc, cost) => acc + cost, 0n)
          );
        });

        it('rent 2 tokens; one is clean token, and extend an non-expired token', async function () {
          await this.rentalContract.connect(user1).rent(user1, [1n], [1000n], [], 0n);
          await time.increase(500n);
          const expectedCosts = calculateFees(this.initialRentalsDuration + 1000n, [500n, 500n], [RENTAL_TYPE.EXTENSION, RENTAL_TYPE.CLEAN]);
          expect(await this.rentalContract.estimateRentalFee(user1, [2n, 1n], [500n, 500n], [])).equal(
            expectedCosts.reduce((acc, cost) => acc + cost, 0n)
          );
        });

        it('rent 2 tokens; one is clean token, and extend an non-expired token, while collecting 2 expired tokens', async function () {
          await this.rentalContract.connect(user1).rent(user1, [10n], [5000n], [], 0n);
          await time.increase(1500n);
          const expectedCosts = calculateFees(
            this.initialRentalsDuration + 5000n - 2n * 1000n,
            [1000n, 50n],
            [RENTAL_TYPE.EXTENSION, RENTAL_TYPE.CLEAN]
          );
          expect(await this.rentalContract.estimateRentalFee(user1, [10n, 1n], [1000n, 50n], [400n, 401n])).equal(
            expectedCosts.reduce((acc, cost) => acc + cost, 0n)
          );
        });
      });
    }
  );

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
        .to.be.revertedWithCustomError(this.rentalContract, 'TokenNotRented')
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
        .to.be.revertedWithCustomError(this.rentalContract, 'TokenNotRented')
        .withArgs(12n);
    });

    it('4 tokens passed, only 3 tokens expired', async function () {
      await time.increase(1000n);
      await expect(this.rentalContract.calculateElapsedTimeForExpiredTokens([400n, 401n, 402n, 403n]))
        .to.be.revertedWithCustomError(this.rentalContract, 'TokenNotExpired')
        .withArgs(403n);
    });
  });

  context('setLandPriceHelper(address newRentalFeeHelper) external', function () {
    it('Success', async function () {
      await expect(this.rentalContract.connect(rentalOperator).setLandPriceHelper(ZeroAddress))
        .to.emit(this.rentalContract, 'LandPriceHelperUpdated')
        .withArgs(ZeroAddress);
    });

    it('Failure because it set by non operator wallet', async function () {
      await expect(this.rentalContract.connect(user1).setLandPriceHelper(ZeroAddress))
        .to.be.revertedWithCustomError(this.rentalContract, 'NotRoleHolder')
        .withArgs(await this.nodeKeyContract.OPERATOR_ROLE(), user1);
    });
  });

  context('setMaxTokenSupply(uint256 newMaxTokenSupply) external', function () {
    it('Success', async function () {
      await expect(this.rentalContract.connect(rentalOperator).setMaxTokenSupply(1000n))
        .to.emit(this.rentalContract, 'MaxTokenSupplyUpdated')
        .withArgs(1000n);
    });

    it('Failure because it set by non operator wallet', async function () {
      await expect(this.rentalContract.connect(user1).setMaxTokenSupply(1000n))
        .to.be.revertedWithCustomError(this.rentalContract, 'NotRoleHolder')
        .withArgs(await this.nodeKeyContract.OPERATOR_ROLE(), user1);
    });
  });

  context('setMaintenanceFee(uint256 newMaintenanceFee, uint256 newMaintenanceFeeDenominator) external', function () {
    it('Success', async function () {
      await expect(this.rentalContract.connect(rentalOperator).setMaintenanceFee(5n, 2n))
        .to.emit(this.rentalContract, 'MaintenanceFeeUpdated')
        .withArgs(5n, 2n);
    });

    it('Failure because it set by non operator wallet', async function () {
      await expect(this.rentalContract.connect(user1).setMaintenanceFee(5n, 2n))
        .to.be.revertedWithCustomError(this.rentalContract, 'NotRoleHolder')
        .withArgs(await this.nodeKeyContract.OPERATOR_ROLE(), user1);
    });
  });

  context('setMinRentalDuration(uint256 newMinRentalDuration) external', function () {
    it('Success', async function () {
      await expect(this.rentalContract.connect(rentalOperator).setMinRentalDuration(100n))
        .to.emit(this.rentalContract, 'MinRentalDurationUpdated')
        .withArgs(100n);
    });

    it('Failure because it set by non operator wallet', async function () {
      await expect(this.rentalContract.connect(user1).setMinRentalDuration(100n))
        .to.be.revertedWithCustomError(this.rentalContract, 'NotRoleHolder')
        .withArgs(await this.nodeKeyContract.OPERATOR_ROLE(), user1);
    });
  });

  context('setMaxRentalDuration(uint256 newMaxRentalDuration) external', function () {
    it('Success', async function () {
      await expect(this.rentalContract.connect(rentalOperator).setMaxRentalDuration(1000n))
        .to.emit(this.rentalContract, 'MaxRentalDurationUpdated')
        .withArgs(1000n);
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
        .withArgs(300n);
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
