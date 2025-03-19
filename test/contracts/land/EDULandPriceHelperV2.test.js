const {expect} = require('chai');

const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');

describe('EDULandPriceHelperV2', function () {
  const CONSTANT_PRICE = 400n;

  const fixture = async function () {
    this.contract = await deployContract('EDULandPriceHelperV2');
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  context('calculatePrice(uint256)', function () {
    it('should return the constant price when totalOngoingRentalTime is 0', async function () {
      const price = await this.contract.calculatePrice(0n);
      expect(price).to.equal(CONSTANT_PRICE);
    });

    it('should return correct amount when totalOngoingRentalTime is 2^256 - 1', async function () {
      const totalOngoingRentalTime = 2n ** 256n - 1n;
      const price = await this.contract.calculatePrice(totalOngoingRentalTime);
      expect(price).to.equal(CONSTANT_PRICE);
    });
  });
});
