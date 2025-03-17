const {expect} = require('chai');

const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');

describe('EDULandPriceHelperV2', function () {
  const DIVIDER = 15000000000n;
  const MULTIPLIER = 17000n;
  const MIN_PRICE = 1000n;

  function bigIntLog2(n) {
    let result = 0n;
    let x = n;

    // Use bit shifting to find log2(n)
    while (x > 1n) {
      x >>= 1n; // Divide by 2 using bitwise shift
      result++;
    }

    return result;
  }

  const fixture = async function () {
    this.contract = await deployContract('EDULandPriceHelperV2');
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  context('calculatePrice(uint256)', function () {
    it('should return the minium price when totalOngoingRentalTime is 0', async function () {
      const price = await this.contract.calculatePrice(0n);
      expect(price).to.equal(MIN_PRICE);
    });

    it('should return the minium price when totalOngoingRentalTime equals to DIVIDER', async function () {
      const price = await this.contract.calculatePrice(DIVIDER);
      expect(price).to.equal(MIN_PRICE);
    });

    it('should return the minium price when totalOngoingRentalTime is less than DIVIDER', async function () {
      const price = await this.contract.calculatePrice(DIVIDER / 2n);
      expect(price).to.equal(MIN_PRICE);
    });

    it('should return correct amount when totalOngoingRentalTime is greater than DIVIDER', async function () {
      const price = await this.contract.calculatePrice(DIVIDER * 2n);
      expect(price).to.equal(MULTIPLIER);
    });

    it('should return correct amount when totalOngoingRentalTime is non-divisible by DIVIDER', async function () {
      const totalOngoingRentalTime = 520992001000n;
      const expected = bigIntLog2(totalOngoingRentalTime / DIVIDER) * MULTIPLIER;
      const price = await this.contract.calculatePrice(totalOngoingRentalTime);
      expect(price).to.equal(expected);
    });

    it('should return correct amount when totalOngoingRentalTime is 2^256 - 1', async function () {
      const totalOngoingRentalTime = 2n ** 256n - 1n;
      const expected = bigIntLog2(totalOngoingRentalTime / DIVIDER) * MULTIPLIER;
      const price = await this.contract.calculatePrice(totalOngoingRentalTime);
      expect(price).to.equal(expected);
    });
  });
});
