const {ethers} = require('hardhat');
const {expect} = require('chai');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {getForwarderRegistryAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');
const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');

const {setupEDUCreditsManager} = require('../setup');

describe('EDUCreditsManager', function () {
  let deployer, other, user, payoutWallet;

  before(async function () {
    [deployer, other, user, payoutWallet] = await ethers.getSigners();
  });

  const fixture = async function () {
    await setupEDUCreditsManager.call(this, deployer, user, payoutWallet);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  describe('constructor(address,address)', function () {
    it('sets the phase to INIT_PHASE', async function () {
      expect(await this.creditsManager.currentPhase()).to.equal(await this.creditsManager.INIT_PHASE());
    });

    it('emits a PhaseSet event', async function () {
      await expect(this.creditsManager.deploymentTransaction().hash)
        .to.emit(this.creditsManager, 'PhaseSet')
        .withArgs(await this.creditsManager.INIT_PHASE());
    });
  });

  describe('setPhase(uint256)', function () {
    it('reverts if the phase is invalid', async function () {
      const invalidPhase = (await this.creditsManager.WITHDRAW_PHASE()) + 1n;
      await expect(this.creditsManager.setPhase(invalidPhase))
        .to.be.revertedWithCustomError(this.creditsManager, 'SettingInvalidPhase')
        .withArgs(invalidPhase);
    });

    it('reverts if not called by the contract owner', async function () {
      await expect(this.creditsManager.connect(other).setPhase(await this.creditsManager.DEPOSIT_PHASE()))
        .to.be.revertedWithCustomError(this.creditsManager, 'NotContractOwner')
        .withArgs(other.address);
    });

    context('when successful', function () {
      beforeEach(async function () {
        this.receipt = await this.creditsManager.setPhase(await this.creditsManager.DEPOSIT_PHASE());
      });

      it('sets the phase', async function () {
        expect(await this.creditsManager.currentPhase()).to.equal(await this.creditsManager.DEPOSIT_PHASE());
      });

      it('emits a DataSet event', async function () {
        await expect(this.receipt)
          .to.emit(this.creditsManager, 'PhaseSet')
          .withArgs(await this.creditsManager.DEPOSIT_PHASE());
      });
    });
  });

  describe('setInitialCredits(address[],uint256[],uint256[],bool[])', function () {
    it('reverts with inconsistent arrays length', async function () {
      await expect(this.creditsManager.setInitialCredits([], [1], [1], [true])).to.be.revertedWithCustomError(
        this.creditsManager,
        'InconsistentArrayLengths'
      );
      await expect(this.creditsManager.setInitialCredits([ethers.ZeroAddress], [], [1], [true])).to.be.revertedWithCustomError(
        this.creditsManager,
        'InconsistentArrayLengths'
      );
      await expect(this.creditsManager.setInitialCredits([ethers.ZeroAddress], [1], [], [true])).to.be.revertedWithCustomError(
        this.creditsManager,
        'InconsistentArrayLengths'
      );
      await expect(this.creditsManager.setInitialCredits([ethers.ZeroAddress], [1], [1], [])).to.be.revertedWithCustomError(
        this.creditsManager,
        'InconsistentArrayLengths'
      );
    });

    it('reverts if the current phase is incorret', async function () {
      await this.creditsManager.setPhase(await this.creditsManager.DEPOSIT_PHASE());
      await expect(this.creditsManager.setInitialCredits([user.address], [1], [1], [true]))
        .to.be.revertedWithCustomError(this.creditsManager, 'OnlyDuringPhase')
        .withArgs(await this.creditsManager.INIT_PHASE(), await this.creditsManager.DEPOSIT_PHASE());
    });

    it('reverts if not called by the contract owner', async function () {
      await expect(this.creditsManager.connect(other).setInitialCredits([user.address], [1], [1], [true]))
        .to.be.revertedWithCustomError(this.creditsManager, 'NotContractOwner')
        .withArgs(other.address);
    });

    it('reverts with a zero address user', async function () {
      await expect(this.creditsManager.setInitialCredits([ethers.ZeroAddress], [1], [1], [true])).to.be.revertedWithCustomError(
        this.creditsManager,
        'ZeroAddressUser'
      );
    });

    it('reverts with a zero value unclaimed credits', async function () {
      await expect(this.creditsManager.setInitialCredits([user.address], [0], [1], [true]))
        .to.be.revertedWithCustomError(this.creditsManager, 'ZeroValueUnclaimedCredits')
        .withArgs(user.address);
    });

    it('reverts for a user with initial credits already set', async function () {
      await this.creditsManager.setInitialCredits([user.address], [1], [1], [true]);
      await expect(this.creditsManager.setInitialCredits([user.address], [1], [1], [true]))
        .to.be.revertedWithCustomError(this.creditsManager, 'UserCreditsAlreadySet')
        .withArgs(user.address);
    });

    context('when successful', function () {
      beforeEach(async function () {
        this.receipt = await this.creditsManager.setInitialCredits([user.address, other.address], [2, 1], [1, 0], [true, false]);
      });

      it('sets the balances and diamond hand status', async function () {
        const userCredits = await this.creditsManager.userCredits(user.address);
        expect(userCredits.unclaimed).to.equal(2);
        expect(userCredits.bonus).to.equal(1);
        expect(userCredits.diamondHand).to.been.true;
        const otherCredits = await this.creditsManager.userCredits(other.address);
        expect(otherCredits.unclaimed).to.equal(1);
        expect(otherCredits.bonus).to.equal(0);
        expect(otherCredits.diamondHand).to.be.false;
      });

      it('increases the total credits', async function () {
        expect(await this.creditsManager.totalCredits()).to.equal(4);
      });

      it('emits a InitialCreditsSet event', async function () {
        await expect(this.receipt)
          .to.emit(this.creditsManager, 'InitialCreditsSet')
          .withArgs([user.address, other.address], [2, 1], [1, 0], [true, false]);
      });
    });
  });

  describe('onERC20Received(address,address,uint256,bytes)', function () {
    it('reverts if the current phase is incorret', async function () {
      await expect(this.EDUToken.connect(user).safeTransfer(this.creditsManager.getAddress(), 0, '0x'))
        .to.be.revertedWithCustomError(this.creditsManager, 'OnlyDuringPhase')
        .withArgs(await this.creditsManager.DEPOSIT_PHASE(), await this.creditsManager.INIT_PHASE());
    });

    context('when successful', function () {
      beforeEach(async function () {
        await this.creditsManager.setPhase(await this.creditsManager.DEPOSIT_PHASE());
        this.receipt = await this.EDUToken.connect(user).safeTransfer(this.creditsManager.getAddress(), 1, '0x');
      });

      it('increases the deposited balance', async function () {
        const balances = await this.creditsManager.userCredits(user.address);
        expect(balances.deposited).to.equal(1);
      });

      it('increases the total deposit', async function () {
        expect(await this.creditsManager.totalDeposited()).to.equal(1);
      });

      it('increases the total credits', async function () {
        expect(await this.creditsManager.totalCredits()).to.equal(1);
      });

      it('emits a Transfer event', async function () {
        await expect(this.receipt)
          .to.emit(this.EDUToken, 'Transfer')
          .withArgs(user.address, await this.creditsManager.getAddress(), 1);
      });
    });

    context('when consecutively successful', function () {
      beforeEach(async function () {
        await this.creditsManager.setPhase(await this.creditsManager.DEPOSIT_PHASE());
        await this.EDUToken.connect(user).safeTransfer(this.creditsManager.getAddress(), 1, '0x');
        this.receipt = await this.EDUToken.connect(user).safeTransfer(this.creditsManager.getAddress(), 2, '0x');
      });

      it('increases the deposited balance', async function () {
        const balances = await this.creditsManager.userCredits(user.address);
        expect(balances.deposited).to.equal(3);
      });

      it('increases the total deposit', async function () {
        expect(await this.creditsManager.totalDeposited()).to.equal(3);
      });

      it('increases the total credits', async function () {
        expect(await this.creditsManager.totalCredits()).to.equal(3);
      });

      it('emits a Transfer event', async function () {
        await expect(this.receipt)
          .to.emit(this.EDUToken, 'Transfer')
          .withArgs(user.address, await this.creditsManager.getAddress(), 2);
      });
    });
  });

  describe('spend(address,uint256)', function () {
    it('reverts if the current phase is incorret', async function () {
      await expect(this.creditsManager.spend(user.address, 1))
        .to.be.revertedWithCustomError(this.creditsManager, 'OnlyDuringPhase')
        .withArgs(await this.creditsManager.SALE_PHASE(), await this.creditsManager.INIT_PHASE());
    });

    it('reverts if not called by a spender', async function () {
      await this.creditsManager.setPhase(await this.creditsManager.SALE_PHASE());
      await expect(this.creditsManager.spend(user.address, 1))
        .to.be.revertedWithCustomError(this.creditsManager, 'NotRoleHolder')
        .withArgs(await this.creditsManager.SPENDER_ROLE(), deployer.address);
    });

    it('reverts when spending 0 amount', async function () {
      await this.creditsManager.setPhase(await this.creditsManager.SALE_PHASE());
      await this.creditsManager.grantRole(await this.creditsManager.SPENDER_ROLE(), deployer.address);
      await expect(this.creditsManager.spend(user.address, 0))
        .to.be.revertedWithCustomError(this.creditsManager, 'ZeroSpendAmount')
        .withArgs(deployer.address, user.address);
    });

    it('reverts if not enough balance', async function () {
      await this.creditsManager.setPhase(await this.creditsManager.SALE_PHASE());
      await this.creditsManager.grantRole(await this.creditsManager.SPENDER_ROLE(), deployer.address);
      await expect(this.creditsManager.spend(user.address, 1))
        .to.be.revertedWithCustomError(this.creditsManager, 'InsufficientCredits')
        .withArgs(deployer.address, user.address, 1);
    });

    context('when successful', function () {
      beforeEach(async function () {
        await this.creditsManager.setInitialCredits([user.address], [10], [10], [true]);
        await this.creditsManager.setPhase(await this.creditsManager.DEPOSIT_PHASE());
        await this.EDUToken.connect(user).safeTransfer(this.creditsManager.getAddress(), 10, '0x');
        await this.creditsManager.setPhase(await this.creditsManager.SALE_PHASE());
        await this.creditsManager.grantRole(await this.creditsManager.SPENDER_ROLE(), deployer.address);
      });

      context('bonus EDU partially used', function () {
        beforeEach(async function () {
          this.receipt = await this.creditsManager.spend(user.address, 5);
        });

        it('reduces the bonus balance', async function () {
          const balances = await this.creditsManager.userCredits(user.address);
          expect(balances.bonus).to.equal(5);
          expect(balances.unclaimed).to.equal(10);
          expect(balances.deposited).to.equal(10);
        });

        it('does not change the total deposit', async function () {
          expect(await this.creditsManager.totalDeposited()).to.equal(10);
        });

        it('emits a CreditsSpent event', async function () {
          await expect(this.receipt).to.emit(this.creditsManager, 'CreditsSpent').withArgs(deployer.address, user.address, 5, 0, 0);
        });

        it('does not emit a Transfer event', async function () {
          await expect(this.receipt).to.not.emit(this.EDUToken, 'Transfer');
        });
      });

      context('bonus EDU entirely used', function () {
        beforeEach(async function () {
          this.receipt = await this.creditsManager.spend(user.address, 10);
        });

        it('reduces the bonus balance', async function () {
          const balances = await this.creditsManager.userCredits(user.address);
          expect(balances.bonus).to.equal(0);
          expect(balances.unclaimed).to.equal(10);
          expect(balances.deposited).to.equal(10);
        });

        it('does not change the total deposit', async function () {
          expect(await this.creditsManager.totalDeposited()).to.equal(10);
        });

        it('emits a CreditsSpent event', async function () {
          await expect(this.receipt).to.emit(this.creditsManager, 'CreditsSpent').withArgs(deployer.address, user.address, 10, 0, 0);
        });

        it('does not emit a Transfer event', async function () {
          await expect(this.receipt).to.not.emit(this.EDUToken, 'Transfer');
        });
      });

      context('unclaimed EDU partially used', function () {
        beforeEach(async function () {
          this.receipt = await this.creditsManager.spend(user.address, 15);
        });

        it('reduces the bonus and unclaimed balances', async function () {
          const balances = await this.creditsManager.userCredits(user.address);
          expect(balances.bonus).to.equal(0);
          expect(balances.unclaimed).to.equal(5);
          expect(balances.deposited).to.equal(10);
        });

        it('does not change the total deposit', async function () {
          expect(await this.creditsManager.totalDeposited()).to.equal(10);
        });

        it('emits a CreditsSpent event', async function () {
          await expect(this.receipt).to.emit(this.creditsManager, 'CreditsSpent').withArgs(deployer.address, user.address, 10, 5, 0);
        });

        it('does not emit a Transfer event', async function () {
          await expect(this.receipt).to.not.emit(this.EDUToken, 'Transfer');
        });
      });

      context('unclaimed EDU entirely used', function () {
        beforeEach(async function () {
          this.receipt = await this.creditsManager.spend(user.address, 20);
        });

        it('reduces the bonus and unclaimed balances', async function () {
          const balances = await this.creditsManager.userCredits(user.address);
          expect(balances.bonus).to.equal(0);
          expect(balances.unclaimed).to.equal(0);
          expect(balances.deposited).to.equal(10);
        });

        it('does not change the total deposit', async function () {
          expect(await this.creditsManager.totalDeposited()).to.equal(10);
        });

        it('emits a CreditsSpent event', async function () {
          await expect(this.receipt).to.emit(this.creditsManager, 'CreditsSpent').withArgs(deployer.address, user.address, 10, 10, 0);
        });

        it('does not emit a Transfer event', async function () {
          await expect(this.receipt).to.not.emit(this.EDUToken, 'Transfer');
        });
      });

      context('deposited EDU partially used', function () {
        beforeEach(async function () {
          this.receipt = await this.creditsManager.spend(user.address, 25);
        });

        it('reduces the bonus, unclaimed and deposited balances', async function () {
          const balances = await this.creditsManager.userCredits(user.address);
          expect(balances.unclaimed).to.equal(0);
          expect(balances.bonus).to.equal(0);
          expect(balances.deposited).to.equal(5);
        });

        it('reduces the total deposit', async function () {
          expect(await this.creditsManager.totalDeposited()).to.equal(5);
        });

        it('emits a CreditsSpent event', async function () {
          await expect(this.receipt).to.emit(this.creditsManager, 'CreditsSpent').withArgs(deployer.address, user.address, 10, 10, 5);
        });

        it('emits a Transfer event', async function () {
          await expect(this.receipt)
            .to.emit(this.EDUToken, 'Transfer')
            .withArgs(await this.creditsManager.getAddress(), payoutWallet.address, 5);
        });
      });

      context('deposited EDU entirely used', function () {
        beforeEach(async function () {
          this.receipt = await this.creditsManager.spend(user.address, 30);
        });

        it('reduces the bonus, unclaimed and deposited balances', async function () {
          const balances = await this.creditsManager.userCredits(user.address);
          expect(balances.unclaimed).to.equal(0);
          expect(balances.bonus).to.equal(0);
          expect(balances.deposited).to.equal(0);
        });

        it('reduces the total deposit', async function () {
          expect(await this.creditsManager.totalDeposited()).to.equal(0);
        });

        it('emits a CreditsSpent event', async function () {
          await expect(this.receipt).to.emit(this.creditsManager, 'CreditsSpent').withArgs(deployer.address, user.address, 10, 10, 10);
        });

        it('emits a Transfer event', async function () {
          await expect(this.receipt)
            .to.emit(this.EDUToken, 'Transfer')
            .withArgs(await this.creditsManager.getAddress(), payoutWallet.address, 10);
        });
      });
    });

    describe('withdraw()', function () {
      it('reverts if the current phase is incorret', async function () {
        await expect(this.creditsManager.withdraw())
          .to.be.revertedWithCustomError(this.creditsManager, 'OnlyDuringPhase')
          .withArgs(await this.creditsManager.WITHDRAW_PHASE(), await this.creditsManager.INIT_PHASE());
      });

      context('when successful, with only unclaimed balance', function () {
        beforeEach(async function () {
          await this.creditsManager.setInitialCredits([user.address], [10], [0], [true]);
          await this.creditsManager.setPhase(await this.creditsManager.WITHDRAW_PHASE());
          this.receipt = await this.creditsManager.connect(user).withdraw();
        });

        it('sets the unclaimed balance to zero', async function () {
          const balances = await this.creditsManager.userCredits(user.address);
          expect(balances.unclaimed).to.equal(0);
        });

        it('emits a Transfer event', async function () {
          await expect(this.receipt).to.emit(this.EDUToken, 'Transfer').withArgs(deployer.address, user.address, 10);
        });
      });

      context('when successful, with only deposited balance', function () {
        beforeEach(async function () {
          await this.creditsManager.setPhase(await this.creditsManager.DEPOSIT_PHASE());
          await this.EDUToken.connect(user).safeTransfer(this.creditsManager.getAddress(), 10, '0x');
          await this.creditsManager.setPhase(await this.creditsManager.WITHDRAW_PHASE());
          this.receipt = await this.creditsManager.connect(user).withdraw();
        });

        it('sets the deposit balance to zero', async function () {
          const balances = await this.creditsManager.userCredits(user.address);
          expect(balances.deposited).to.equal(0);
        });

        it('reduces the total deposit', async function () {
          expect(await this.creditsManager.totalDeposited()).to.equal(0);
        });

        it('emits a Transfer event', async function () {
          await expect(this.receipt)
            .to.emit(this.EDUToken, 'Transfer')
            .withArgs(await this.creditsManager.getAddress(), user.address, 10);
        });
      });

      context('when successful, with both unclaimed and deposited balances', function () {
        beforeEach(async function () {
          await this.creditsManager.setInitialCredits([user.address], [10], [0], [true]);
          await this.creditsManager.setPhase(await this.creditsManager.DEPOSIT_PHASE());
          await this.EDUToken.connect(user).safeTransfer(this.creditsManager.getAddress(), 5, '0x');
          await this.creditsManager.setPhase(await this.creditsManager.WITHDRAW_PHASE());
          this.receipt = await this.creditsManager.connect(user).withdraw();
        });

        it('sets the deposit balance to zero', async function () {
          const balances = await this.creditsManager.userCredits(user.address);
          expect(balances.deposited).to.equal(0);
        });

        it('reduces the total deposit', async function () {
          expect(await this.creditsManager.totalDeposited()).to.equal(0);
        });

        it('emits 2 Transfer events', async function () {
          await expect(this.receipt).to.emit(this.EDUToken, 'Transfer').withArgs(deployer.address, user.address, 10);
          await expect(this.receipt)
            .to.emit(this.EDUToken, 'Transfer')
            .withArgs(await this.creditsManager.getAddress(), user.address, 5);
        });
      });

      context('when successful without deposited or unclaimed balance', function () {
        beforeEach(async function () {
          await this.creditsManager.setPhase(await this.creditsManager.WITHDRAW_PHASE());
          this.receipt = await this.creditsManager.connect(user).withdraw();
        });

        it('does not emit a Transfer event', async function () {
          await expect(this.receipt).to.not.emit(this.EDUToken, 'Transfer');
        });
      });
    });
  });

  describe('recoverERC20s(address[],address[],uint256[])', function () {
    it('reverts if not called by the contract owner', async function () {
      await expect(this.creditsManager.connect(other).recoverERC20s([], [], []))
        .to.be.revertedWithCustomError(this.creditsManager, 'NotContractOwner')
        .withArgs(other.address);
    });

    it('reverts if trying to recover deposited ERC20', async function () {
      await this.creditsManager.setPhase(await this.creditsManager.DEPOSIT_PHASE());
      await this.EDUToken.connect(user).safeTransfer(this.creditsManager.getAddress(), 10, '0x');
      await expect(this.creditsManager.recoverERC20s([other.address], [this.EDUToken.getAddress()], [1])).to.be.revertedWithCustomError(
        this.creditsManager,
        'UnrecoverableEDU'
      );
    });

    context('when successful', function () {
      beforeEach(async function () {
        this.otherERC20 = await deployContract('ERC20MintBurn', '', '', 18, await getForwarderRegistryAddress());
        await this.creditsManager.setPhase(await this.creditsManager.DEPOSIT_PHASE());
        await this.EDUToken.connect(user).safeTransfer(this.creditsManager.getAddress(), 10, '0x');
        await this.EDUToken.connect(user).transfer(this.creditsManager.getAddress(), 5);
        this.receipt = await this.creditsManager.recoverERC20s(
          [other.address, other.address, other.address],
          [this.EDUToken.getAddress(), this.EDUToken.getAddress(), this.otherERC20.getAddress()],
          [3, 2, 0]
        );
      });

      it('emits Transfer events', async function () {
        await expect(this.receipt)
          .to.emit(this.EDUToken, 'Transfer')
          .withArgs(await this.creditsManager.getAddress(), other.address, 3);
        await expect(this.receipt)
          .to.emit(this.EDUToken, 'Transfer')
          .withArgs(await this.creditsManager.getAddress(), other.address, 2);
      });
    });
  });

  describe('_msgData()', function () {
    it('returns the msg.data', async function () {
      await this.creditsManager.__msgData();
    });
  });
});
