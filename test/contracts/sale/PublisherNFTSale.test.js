const {ethers, network} = require('hardhat');
const {expect} = require('chai');
const {time} = require('@nomicfoundation/hardhat-network-helpers');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {getForwarderRegistryAddress, getOperatorFilterRegistryAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');
const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');

const {setupPublisherNFTSale} = require('../setup');

describe('PublisherNFTSale', function () {
  let accounts;
  let deployer, user, payoutWallet, other, genesisNft0Holder, genesisNft1Holder;

  before(async function () {
    accounts = await ethers.getSigners();
    [deployer, user, payoutWallet, other, genesisNft0Holder, genesisNft1Holder] = accounts;
  });

  const fixture = async function () {
    await setupPublisherNFTSale.call(this, deployer, user, payoutWallet, other, genesisNft0Holder, genesisNft1Holder);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  describe('constructor(address,address,address,uint16,uint256,uint256,uint256[],uint256[],uint256[])', function () {
    it('reverts if the timestamps are not increasing', async function () {
      await expect(
        deployContract(
          'PublisherNFTSale',
          this.genesisToken.address,
          this.creditsManager.address,
          this.lzEndpoint.address,
          1, // lzDstChainId
          100, // mintPrice
          100, // mintSupplyLimit
          [1, 0, 0, 0], // timestamps
          [1000, 2000, 3000], // discountThresholds
          [5, 10, 15], // discountPercentages
          await getForwarderRegistryAddress()
        )
      ).to.be.revertedWithCustomError(this.sale, 'InvalidTimestamps');
      await expect(
        deployContract(
          'PublisherNFTSale',
          this.genesisToken.address,
          this.creditsManager.address,
          this.lzEndpoint.address,
          1, // lzDstChainId
          100, // mintPrice
          100, // mintSupplyLimit
          [0, 1, 0, 1], // timestamps
          [1000, 2000, 3000], // discountThresholds
          [5, 10, 15], // discountPercentages
          await getForwarderRegistryAddress()
        )
      ).to.be.revertedWithCustomError(this.sale, 'InvalidTimestamps');
      await expect(
        deployContract(
          'PublisherNFTSale',
          this.genesisToken.address,
          this.creditsManager.address,
          this.lzEndpoint.address,
          1, // lzDstChainId
          100, // mintPrice
          100, // mintSupplyLimit
          [0, 1, 2, 1], // timestamps
          [1000, 2000, 3000], // discountThresholds
          [5, 10, 15], // discountPercentages
          await getForwarderRegistryAddress()
        )
      ).to.be.revertedWithCustomError(this.sale, 'InvalidTimestamps');
    });
    it('reverts if the discount thresholds are not increasing', async function () {
      await expect(
        deployContract(
          'PublisherNFTSale',
          this.genesisToken.address,
          this.creditsManager.address,
          this.lzEndpoint.address,
          1, // lzDstChainId
          100, // mintPrice
          100, // mintSupplyLimit
          [0, 1, 2, 3], // timestamps
          [1000, 0, 1999], // discountThresholds
          [5, 10, 15], // discountPercentages
          await getForwarderRegistryAddress()
        )
      ).to.be.revertedWithCustomError(this.sale, 'InvalidDiscountThresholds');
      await expect(
        deployContract(
          'PublisherNFTSale',
          this.genesisToken.address,
          this.creditsManager.address,
          this.lzEndpoint.address,
          1, // lzDstChainId
          100, // mintPrice
          100, // mintSupplyLimit
          [0, 1, 2, 3], // timestamps
          [1000, 2000, 1999], // discountThresholds
          [5, 10, 15], // discountPercentages
          await getForwarderRegistryAddress()
        )
      ).to.be.revertedWithCustomError(this.sale, 'InvalidDiscountThresholds');
    });
    it('reverts if the discount percentages are not increasing', async function () {
      await expect(
        deployContract(
          'PublisherNFTSale',
          this.genesisToken.address,
          this.creditsManager.address,
          this.lzEndpoint.address,
          1, // lzDstChainId
          100, // mintPrice
          100, // mintSupplyLimit
          [0, 1, 2, 3], // timestamps
          [1000, 2000, 3000], // discountThresholds
          [5, 0, 5], // discountPercentages
          await getForwarderRegistryAddress()
        )
      ).to.be.revertedWithCustomError(this.sale, 'InvalidDiscountPercentages');
      await expect(
        deployContract(
          'PublisherNFTSale',
          this.genesisToken.address,
          this.creditsManager.address,
          this.lzEndpoint.address,
          1, // lzDstChainId
          100, // mintPrice
          100, // mintSupplyLimit
          [0, 1, 2, 3], // timestamps
          [1000, 2000, 3000], // discountThresholds
          [5, 10, 5], // discountPercentages
          await getForwarderRegistryAddress()
        )
      ).to.be.revertedWithCustomError(this.sale, 'InvalidDiscountPercentages');
    });

    it('sets the genesis token address', async function () {
      expect(await this.sale.GENESIS_TOKEN()).to.equal(await this.genesisToken.address);
    });

    it('sets the EDU credits manager address', async function () {
      expect(await this.sale.EDU_CREDITS_MANAGER()).to.equal(await this.creditsManager.address);
    });

    it('sets the LZ endpoint address', async function () {
      expect(await this.sale.LZ_ENDPOINT()).to.equal(await this.lzEndpoint.address);
    });

    it('sets the LZ destination chain id ', async function () {
      expect(await this.sale.LZ_DST_CHAINID()).to.equal(1);
    });

    it('sets the mint price', async function () {
      expect(await this.sale.MINT_PRICE()).to.equal(100);
    });

    it('sets the mint supply limit', async function () {
      expect(await this.sale.MINT_SUPPLY_LIMIT()).to.equal(2);
    });
  });

  describe('setLzDstAddress(address)', function () {
    it('reverts when not called by the contract owner', async function () {
      await expect(this.sale.connect(user).setLzDstAddress(ethers.constants.AddressZero))
        .to.be.revertedWithCustomError(this.sale, 'NotContractOwner')
        .withArgs(user.address);
    });

    it('reverts when the lz destination address has already been set', async function () {
      this.sale.setLzDstAddress(user.address);
      await expect(this.sale.setLzDstAddress(user.address)).to.be.revertedWithCustomError(this.sale, 'LzDstAddressAlreadySet');
    });

    it('sets the lzDstAddress', async function () {
      await this.sale.setLzDstAddress(user.address);
      expect(await this.sale.lzDstAddress()).to.equal(user.address);
    });
  });

  describe('mint(uint256)', function () {
    it('reverts if the sale has not started', async function () {
      await this.sale.setLzDstAddress(other.address);
      await expect(this.sale.connect(user).mint(1)).to.be.revertedWithCustomError(this.sale, 'SaleNotStarted');
    });

    it('reverts if the sale is in phase 1 but the caller is not a diamond hand', async function () {
      await this.sale.setLzDstAddress(other.address);
      await time.increase(10000);
      await expect(this.sale.connect(other).mint(1)).to.be.revertedWithCustomError(this.sale, 'NotADiamondHand');
    });

    it('reverts if the sale is in phase 2 but the caller is not a diamond hand nor a genesis token holder', async function () {
      await this.sale.setLzDstAddress(other.address);
      await time.increase(20000);
      await expect(this.sale.connect(other).mint(1)).to.be.revertedWithCustomError(this.sale, 'NotADiamondHandNorAGenesisNFTOwner');
    });

    it('reverts if the sale has ended', async function () {
      await this.sale.setLzDstAddress(other.address);
      await time.increase(40000);
      await expect(this.sale.connect(other).mint(1)).to.be.revertedWithCustomError(this.sale, 'SaleEnded');
    });

    it('reverts if the LZ destination address has not been set yet', async function () {
      await time.increase(30000);
      await expect(this.sale.connect(user).mint(1)).to.be.revertedWithCustomError(this.sale, 'LzDstAddressNotSet');
    });

    it('reverts if the supply is insufficient', async function () {
      await time.increase(30000);
      await this.sale.setLzDstAddress(other.address);
      await this.sale.connect(user).mint(1);
      await this.sale.connect(genesisNft0Holder).mint(1);
      await expect(this.sale.connect(user).mint(1)).to.be.revertedWithCustomError(this.sale, 'InsufficientMintSupply');
    });

    context('when successful ()', function () {
      beforeEach(async function () {
        await this.sale.setLzDstAddress(other.address);
      });

      function onSuccess(buyerIndex, price, threshold) {
        it('increases the mint count', async function () {
          expect(await this.sale.mintCount()).to.equal(1);
        });

        it('spends the amount of EDU from the credits manager', async function () {
          await expect(this.receipt)
            .to.emit(this.creditsManager, 'CreditsSpent')
            .withArgs(this.sale.address, accounts[buyerIndex].address, 0, price, 0);
        });

        it('emits a MintInitiated event', async function () {
          await expect(this.receipt).to.emit(this.sale, 'MintInitiated').withArgs(accounts[buyerIndex].address, 1, threshold);
        });

        it('calls send on the LZ endpoint', async function () {
          await expect(this.receipt)
            .to.emit(this.lzEndpoint, 'LzSent')
            .withArgs(
              1,
              this.sale.address,
              other.address,
              ethers.utils.defaultAbiCoder.encode(['address', 'uint256'], [accounts[buyerIndex].address, 1]),
              this.sale.address,
              ethers.constants.AddressZero,
              ethers.utils.solidityPack(['uint16', 'uint256'], [1, 50000 + 30000])
            );
        });

        it('transfers ETH to the LZ endpoint', async function () {
          expect(await this.lzEndpoint.provider.getBalance(this.lzEndpoint.address)).to.equal(
            (await this.lzEndpoint.estimateFees(0, ethers.constants.AddressZero, '0x', false, '0x'))[0]
          );
        });
      }

      context('during phase 1', function () {
        beforeEach(async function () {
          await time.increase(10000);
        });
        context('without discount threshold reached', function () {
          beforeEach(async function () {
            this.receipt = await this.sale.connect(user).mint(1);
          });
          onSuccess(1, 100, 0);
        });

        context('with discount threshold 1 reached', function () {
          beforeEach(async function () {
            await this.creditsManager.setPhase(0);
            await this.creditsManager.setInitialCredits([other.address], [1000], [0], [false]);
            await this.creditsManager.setPhase(2);
            this.receipt = await this.sale.connect(user).mint(1);
          });
          onSuccess(1, 95, 1);
        });

        context('with discount threshold 2 reached', function () {
          beforeEach(async function () {
            await this.creditsManager.setPhase(0);
            await this.creditsManager.setInitialCredits([other.address], [2000], [0], [false]);
            await this.creditsManager.setPhase(2);
            this.receipt = await this.sale.connect(user).mint(1);
          });
          onSuccess(1, 90, 2);
        });

        context('with discount threshold 3 reached', function () {
          beforeEach(async function () {
            await this.creditsManager.setPhase(0);
            await this.creditsManager.setInitialCredits([other.address], [3000], [0], [false]);
            await this.creditsManager.setPhase(2);
            this.receipt = await this.sale.connect(user).mint(1);
          });
          onSuccess(1, 85, 3);
        });
      });

      context('during phase 2', function () {
        beforeEach(async function () {
          await time.increase(20000);
        });
        context('without discount threshold reached', function () {
          context('by a diamond hand', function () {
            beforeEach(async function () {
              this.receipt = await this.sale.connect(user).mint(1);
            });
            onSuccess(1, 100, 0);
          });
          context('by a genesis token 0 holder', function () {
            beforeEach(async function () {
              this.receipt = await this.sale.connect(genesisNft0Holder).mint(1);
            });
            onSuccess(4, 100, 0);
          });
          context('by a genesis token 1 holder', function () {
            beforeEach(async function () {
              this.receipt = await this.sale.connect(genesisNft1Holder).mint(1);
            });
            onSuccess(5, 100, 0);
          });
        });

        context('with discount threshold 1 reached', function () {
          beforeEach(async function () {
            await this.creditsManager.setPhase(0);
            await this.creditsManager.setInitialCredits([other.address], [1000], [0], [false]);
            await this.creditsManager.setPhase(2);
          });
          context('by a diamond hand', function () {
            beforeEach(async function () {
              this.receipt = await this.sale.connect(user).mint(1);
            });
            onSuccess(1, 95, 1);
          });
          context('by a genesis token 0 holder', function () {
            beforeEach(async function () {
              this.receipt = await this.sale.connect(genesisNft0Holder).mint(1);
            });
            onSuccess(4, 95, 1);
          });
          context('by a genesis token 1 holder', function () {
            beforeEach(async function () {
              this.receipt = await this.sale.connect(genesisNft1Holder).mint(1);
            });
            onSuccess(5, 95, 1);
          });
        });

        context('with discount threshold 2 reached', function () {
          beforeEach(async function () {
            await this.creditsManager.setPhase(0);
            await this.creditsManager.setInitialCredits([other.address], [2000], [0], [false]);
            await this.creditsManager.setPhase(2);
          });
          context('by a diamond hand', function () {
            beforeEach(async function () {
              this.receipt = await this.sale.connect(user).mint(1);
            });
            onSuccess(1, 90, 2);
          });
          context('by a genesis token 0 holder', function () {
            beforeEach(async function () {
              this.receipt = await this.sale.connect(genesisNft0Holder).mint(1);
            });
            onSuccess(4, 90, 2);
          });
          context('by a genesis token 1 holder', function () {
            beforeEach(async function () {
              this.receipt = await this.sale.connect(genesisNft1Holder).mint(1);
            });
            onSuccess(5, 90, 2);
          });
        });

        context('with discount threshold 3 reached', function () {
          beforeEach(async function () {
            await this.creditsManager.setPhase(0);
            await this.creditsManager.setInitialCredits([other.address], [3000], [0], [false]);
            await this.creditsManager.setPhase(2);
          });
          context('by a diamond hand', function () {
            beforeEach(async function () {
              this.receipt = await this.sale.connect(user).mint(1);
            });
            onSuccess(1, 85, 3);
          });
          context('by a genesis token 0 holder', function () {
            beforeEach(async function () {
              this.receipt = await this.sale.connect(genesisNft0Holder).mint(1);
            });
            onSuccess(4, 85, 3);
          });
          context('by a genesis token 1 holder', function () {
            beforeEach(async function () {
              this.receipt = await this.sale.connect(genesisNft1Holder).mint(1);
            });
            onSuccess(5, 85, 3);
          });
        });
      });

      context('during phase 3', function () {
        beforeEach(async function () {
          await this.creditsManager.setPhase(0);
          await this.creditsManager.setInitialCredits([deployer.address], [100], [0], [false]);
          await this.creditsManager.setPhase(2);
          await time.increase(30000);
        });
        context('without discount threshold reached', function () {
          beforeEach(async function () {
            this.receipt = await this.sale.connect(deployer).mint(1);
          });
          onSuccess(0, 100, 0);
        });

        context('with discount threshold 1 reached', function () {
          beforeEach(async function () {
            await this.creditsManager.setPhase(0);
            await this.creditsManager.setInitialCredits([other.address], [1000], [0], [false]);
            await this.creditsManager.setPhase(2);
            this.receipt = await this.sale.connect(deployer).mint(1);
          });
          onSuccess(0, 95, 1);
        });

        context('with discount threshold 2 reached', function () {
          beforeEach(async function () {
            await this.creditsManager.setPhase(0);
            await this.creditsManager.setInitialCredits([other.address], [2000], [0], [false]);
            await this.creditsManager.setPhase(2);
            this.receipt = await this.sale.connect(deployer).mint(1);
          });
          onSuccess(0, 90, 2);
        });

        context('with discount threshold 3 reached', function () {
          beforeEach(async function () {
            await this.creditsManager.setPhase(0);
            await this.creditsManager.setInitialCredits([other.address], [3000], [0], [false]);
            await this.creditsManager.setPhase(2);
            this.receipt = await this.sale.connect(deployer).mint(1);
          });
          onSuccess(0, 85, 3);
        });
      });
    });
  });

  describe('withdraw(address)', function () {
    it('reverts when not called by the contract owner', async function () {
      await expect(this.sale.connect(user).withdraw(other.address))
        .to.be.revertedWithCustomError(this.sale, 'NotContractOwner')
        .withArgs(user.address);
    });

    it('transfers the ETH balance to the contract owner', async function () {
      const balanceBefore = await other.getBalance();
      await this.sale.withdraw(other.address);
      const balanceAfter = await other.getBalance();
      expect(balanceAfter.sub(balanceBefore)).to.equal(ethers.utils.parseEther('10.0'));
      await this.sale.withdraw(other.address); // case with 0 balance, does nothing
      expect(balanceAfter.sub(balanceBefore)).to.equal(ethers.utils.parseEther('10.0'));
    });
  });

  describe('currentMintPrice()', function () {
    it('returns the base mint price when no threshold is reached', async function () {
      const currentPrice = await this.sale.currentMintPrice();
      expect(currentPrice[0]).to.equal(100);
      expect(currentPrice[1]).to.equal(0);
    });

    it('returns a discounted mint price when threshold 1 is reached', async function () {
      await this.creditsManager.setPhase(0);
      await this.creditsManager.setInitialCredits([other.address], [1000], [0], [false]);
      await this.creditsManager.setPhase(2);
      const currentPrice = await this.sale.currentMintPrice();
      expect(currentPrice[0]).to.equal(95);
      expect(currentPrice[1]).to.equal(1);
    });

    it('returns a discounted mint price when threshold 2 is reached', async function () {
      await this.creditsManager.setPhase(0);
      await this.creditsManager.setInitialCredits([other.address], [2000], [0], [false]);
      await this.creditsManager.setPhase(2);
      const currentPrice = await this.sale.currentMintPrice();
      expect(currentPrice[0]).to.equal(90);
      expect(currentPrice[1]).to.equal(2);
    });

    it('returns a discounted mint price when threshold 3 is reached', async function () {
      await this.creditsManager.setPhase(0);
      await this.creditsManager.setInitialCredits([other.address], [3000], [0], [false]);
      await this.creditsManager.setPhase(2);
      const currentPrice = await this.sale.currentMintPrice();
      expect(currentPrice[0]).to.equal(85);
      expect(currentPrice[1]).to.equal(3);
    });
  });

  describe('currentSalePhase()', function () {
    it('returns 0 before the sale start', async function () {
      expect(await this.sale.currentSalePhase()).to.equal(0);
    });

    it('returns 1 during the phase 1', async function () {
      await time.increase(10000);
      expect(await this.sale.currentSalePhase()).to.equal(1);
    });

    it('returns 2 during the phase 2', async function () {
      await time.increase(20000);
      expect(await this.sale.currentSalePhase()).to.equal(2);
    });

    it('returns 3 during the phase 3', async function () {
      await time.increase(30000);
      expect(await this.sale.currentSalePhase()).to.equal(3);
    });

    it('returns 4 after sale ended', async function () {
      await time.increase(40000);
      expect(await this.sale.currentSalePhase()).to.equal(4);
    });
  });

  describe('canMint(address)', function () {
    context('when the sale has not started', function () {
      it('returns false for a diamond hand account', async function () {
        expect(await this.sale.canMint(user.address)).to.be.false;
      });

      it('returns false for a genesis token 0 holder account', async function () {
        expect(await this.sale.canMint(genesisNft0Holder.address)).to.be.false;
      });

      it('returns false for a genesis token 1 holder account', async function () {
        expect(await this.sale.canMint(genesisNft1Holder.address)).to.be.false;
      });

      it('returns false for another account', async function () {
        expect(await this.sale.canMint(other.address)).to.be.false;
      });
    });

    context('when the sale is in phase 1', function () {
      beforeEach(async function () {
        await time.increase(10000);
      });

      it('returns true for a diamond hand account', async function () {
        expect(await this.sale.canMint(user.address)).to.be.true;
      });

      it('returns false for a genesis token 0 holder account', async function () {
        expect(await this.sale.canMint(genesisNft0Holder.address)).to.be.false;
      });

      it('returns false for a genesis token 1 holder account', async function () {
        expect(await this.sale.canMint(genesisNft1Holder.address)).to.be.false;
      });

      it('returns false for another account', async function () {
        expect(await this.sale.canMint(other.address)).to.be.false;
      });
    });

    context('when the sale is in phase 2', function () {
      beforeEach(async function () {
        await time.increase(20000);
      });

      it('returns true for a diamond hand account', async function () {
        expect(await this.sale.canMint(user.address)).to.be.true;
      });

      it('returns true for a genesis token 0 holder account', async function () {
        expect(await this.sale.canMint(genesisNft0Holder.address)).to.be.true;
      });

      it('returns true for a genesis token 1 holder account', async function () {
        expect(await this.sale.canMint(genesisNft1Holder.address)).to.be.true;
      });

      it('returns false for another account', async function () {
        expect(await this.sale.canMint(other.address)).to.be.false;
      });
    });

    context('when the sale is in phase 3', function () {
      beforeEach(async function () {
        await time.increase(30000);
      });

      it('returns true for a diamond hand account', async function () {
        expect(await this.sale.canMint(user.address)).to.be.true;
      });

      it('returns true for a genesis token 0 holder account', async function () {
        expect(await this.sale.canMint(genesisNft0Holder.address)).to.be.true;
      });

      it('returns true for a genesis token 1 holder account', async function () {
        expect(await this.sale.canMint(genesisNft1Holder.address)).to.be.true;
      });

      it('returns true for another holder account', async function () {
        expect(await this.sale.canMint(other.address)).to.be.true;
      });
    });

    context('when the sale has ended', function () {
      beforeEach(async function () {
        await time.increase(40000);
      });

      it('returns false for a diamond hand account', async function () {
        expect(await this.sale.canMint(user.address)).to.be.false;
      });

      it('returns false for a genesis token 0 holder account', async function () {
        expect(await this.sale.canMint(genesisNft0Holder.address)).to.be.false;
      });

      it('returns false for a genesis token 1 holder account', async function () {
        expect(await this.sale.canMint(genesisNft1Holder.address)).to.be.false;
      });

      it('returns false for another account', async function () {
        expect(await this.sale.canMint(other.address)).to.be.false;
      });
    });
  });

  describe('_msgData()', function () {
    it('returns the msg.data', async function () {
      await this.sale.__msgData();
    });
  });
});
