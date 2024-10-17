const {ethers} = require('hardhat');
const {expect} = require('chai');
const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {getForwarderRegistryAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');

describe('Points', function () {
  before(async function () {
    [deployer, owner, admin, spender, depositor, user1, user2, user3, user4, user5, other] = await ethers.getSigners();
  });

  const fixture = async function () {
    this.forwarderRegistryAddress = await getForwarderRegistryAddress();

    this.contract = await deployContract('Points', this.forwarderRegistryAddress);
    this.allowedConsumeReasonCodes = [
      '0x0000000000000000000000000000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000000000000000000000000000002',
      '0x0000000000000000000000000000000000000000000000000000000000000003',
    ];
    this.depositReasonCode = '0x0000000000000000000000000000000000000000000000000000000000000004';

    await this.contract.grantRole(await this.contract.ADMIN_ROLE(), admin.address);
    await this.contract.grantRole(await this.contract.SPENDER_ROLE(), spender.address);
    await this.contract.grantRole(await this.contract.DEPOSITOR_ROLE(), depositor.address);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  describe('constructor', function () {
    it('reverts if the forwarder registry address is 0', async function () {
      await expect(deployContract('Points', '0x0000000000000000000000000000000000000000')).to.be.revertedWithCustomError(
        this.contract,
        'InvalidForwarderRegistry'
      );
    });
  });

  describe('addConsumeReasonCodes(bytes32[] calldata reasonCodes)', function () {
    it('Reverts if the sender does not have Admin role', async function () {
      await expect(this.contract.connect(other).addConsumeReasonCodes(this.allowedConsumeReasonCodes))
        .to.revertedWithCustomError(this.contract, 'NotRoleHolder')
        .withArgs(await this.contract.ADMIN_ROLE(), other.address);
    });

    it('Reverts if the given reason codes array is empty', async function () {
      await expect(this.contract.connect(admin).addConsumeReasonCodes([])).to.revertedWithCustomError(this.contract, 'ConsumeReasonCodesArrayEmpty');
    });

    it('Reverts if any of the reason codes already exists', async function () {
      await this.contract.connect(admin).addConsumeReasonCodes(this.allowedConsumeReasonCodes);

      const existingConsumeReasonCode = this.allowedConsumeReasonCodes[0];
      await expect(this.contract.connect(admin).addConsumeReasonCodes([existingConsumeReasonCode]))
        .to.revertedWithCustomError(this.contract, 'ConsumeReasonCodeAlreadyExists')
        .withArgs(existingConsumeReasonCode);
    });

    context('when successful', function () {
      it('it should add the consume reason codes', async function () {
        await this.contract.connect(admin).addConsumeReasonCodes(this.allowedConsumeReasonCodes);

        const code0Exists = await this.contract.allowedConsumeReasonCodes(this.allowedConsumeReasonCodes[0]);
        const code1Exists = await this.contract.allowedConsumeReasonCodes(this.allowedConsumeReasonCodes[1]);
        const code2Exists = await this.contract.allowedConsumeReasonCodes(this.allowedConsumeReasonCodes[2]);

        expect(code0Exists).to.be.true;
        expect(code1Exists).to.be.true;
        expect(code2Exists).to.be.true;
      });

      it('it should emit an ConsumeReasonCodesAdded event', async function () {
        await expect(this.contract.connect(admin).addConsumeReasonCodes(this.allowedConsumeReasonCodes)).to.emit(
          this.contract,
          'ConsumeReasonCodesAdded'
        );
      });
    });
  });

  describe('removeConsumeReasonCodes(bytes32[] reasonCodes)', function () {
    it('Reverts if the sender does not have the Admin role', async function () {
      await this.contract.connect(admin).addConsumeReasonCodes(this.allowedConsumeReasonCodes);

      await expect(this.contract.connect(other).removeConsumeReasonCodes(this.allowedConsumeReasonCodes))
        .to.revertedWithCustomError(this.contract, 'NotRoleHolder')
        .withArgs(await this.contract.ADMIN_ROLE(), other.address);
    });

    it('Reverts if the given reason codes array is empty', async function () {
      await this.contract.connect(admin).addConsumeReasonCodes(this.allowedConsumeReasonCodes);

      await expect(this.contract.connect(admin).removeConsumeReasonCodes([])).to.revertedWithCustomError(
        this.contract,
        'ConsumeReasonCodesArrayEmpty'
      );
    });

    it('Reverts if any of the given reason codes do not exist', async function () {
      await expect(this.contract.connect(admin).removeConsumeReasonCodes([this.allowedConsumeReasonCodes[0]]))
        .to.revertedWithCustomError(this.contract, 'ConsumeReasonCodeDoesNotExist')
        .withArgs(this.allowedConsumeReasonCodes[0]);
    });

    context('when successful', function () {
      it('it should remove the consume reason codes', async function () {
        await this.contract.connect(admin).addConsumeReasonCodes(this.allowedConsumeReasonCodes);

        await this.contract.connect(admin).removeConsumeReasonCodes([this.allowedConsumeReasonCodes[0], this.allowedConsumeReasonCodes[1]]);

        const code0Exists = await this.contract.allowedConsumeReasonCodes(this.allowedConsumeReasonCodes[0]);
        const code1Exists = await this.contract.allowedConsumeReasonCodes(this.allowedConsumeReasonCodes[1]);
        const code2Exists = await this.contract.allowedConsumeReasonCodes(this.allowedConsumeReasonCodes[2]);

        expect(code0Exists).to.be.false;
        expect(code1Exists).to.be.false;
        expect(code2Exists).to.be.true;
      });

      it('it should emit an ConsumeReasonCodesRemoved event', async function () {
        await this.contract.connect(admin).addConsumeReasonCodes(this.allowedConsumeReasonCodes);
        await expect(this.contract.connect(admin).removeConsumeReasonCodes(this.allowedConsumeReasonCodes)).to.emit(
          this.contract,
          'ConsumeReasonCodesRemoved'
        );
      });
    });
  });

  describe('deposit(address holder, uint256 amount, bytes32 depositReasonCode)', function () {
    it('Reverts if the sender does not have Depositor role', async function () {
      await expect(this.contract.connect(other).deposit(user1.address, 100, this.depositReasonCode))
        .to.revertedWithCustomError(this.contract, 'NotRoleHolder')
        .withArgs(await this.contract.DEPOSITOR_ROLE(), other.address);
    });

    it('Reverts if deposit amount is zero', async function () {
      await expect(this.contract.connect(depositor).deposit(user1.address, 0, this.depositReasonCode)).to.revertedWithCustomError(
        this.contract,
        'DepositZeroAmount'
      );
    });

    context('when successful', function () {
      it('it should update to correct balance', async function () {
        const amount = 100;
        await this.contract.connect(depositor).deposit(user1.address, amount, this.depositReasonCode);
        const balance = await this.contract.balances(user1.address);
        expect(balance).equal(amount);
      });

      it('it should emit an Deposited event', async function () {
        const amount = 100;
        await expect(this.contract.connect(depositor).deposit(user1.address, amount, this.depositReasonCode))
          .to.emit(this.contract, 'Deposited')
          .withArgs(depositor.address, this.depositReasonCode, user1.address, amount);
      });
    });
  });

  // eslint-disable-next-line max-len
  describe('consume(address holder, uint256 amount, bytes32 consumeReasonCode, uint256 deadline, address spender, uint8 v, bytes32 r, bytes32 s)', function () {
    it('Reverts if the deadline of the signature has passed', async function () {
      const amount = 100;
      const reasonCode = this.allowedConsumeReasonCodes[0];
      const deadline = 0;
      const v = 0;
      const r = '0x0000000000000000000000000000000000000000000000000000000000000000';
      const s = '0x0000000000000000000000000000000000000000000000000000000000000000';

      await expect(
        this.contract.connect(spender).consume(user1.address, amount, reasonCode, deadline, spender.address, v, r, s)
      ).to.revertedWithCustomError(this.contract, 'ExpiredSignature');
    });

    it('Reverts if sender is not appointed spender', async function () {
      const amount = 100;
      const reasonCode = this.allowedConsumeReasonCodes[0];
      const deadline = 999999999999999;
      const v = 0;
      const r = '0x0000000000000000000000000000000000000000000000000000000000000000';
      const s = '0x0000000000000000000000000000000000000000000000000000000000000000';

      await expect(
        this.contract.connect(other).consume(user1.address, amount, reasonCode, deadline, spender.address, v, r, s)
      ).to.revertedWithCustomError(this.contract, 'SenderIsNotAppointedSpender');
    });

    it('Reverts if the signature is not correct (holder, spender, amount, reaconCode, current nonce)', async function () {
      const amount = 100;
      const reasonCode = this.allowedConsumeReasonCodes[0];
      const deadline = 999999999999999;
      const signature =
        '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
      const {v, r, s} = ethers.Signature.from(signature);
      await expect(
        this.contract.connect(spender).consume(user1.address, amount, reasonCode, deadline, spender.address, v, r, s)
      ).to.revertedWithCustomError(this.contract, 'InvalidSignature');
    });

    it('Reverts if the signer does not have enough balance', async function () {
      const amount = 100;
      const holderAddress = user1.address;
      const spenderAddress = spender.address;
      const reasonCode = this.allowedConsumeReasonCodes[0];
      const deadline = 999999999999999;
      const messageHash = await this.contract.preparePayload(holderAddress, spenderAddress, amount, reasonCode, deadline);
      const signature = await user1.signMessage(ethers.getBytes(messageHash));
      const {v, r, s} = ethers.Signature.from(signature);

      await expect(this.contract.connect(spender).consume(user1.address, amount, reasonCode, deadline, spender.address, v, r, s))
        .to.revertedWithCustomError(this.contract, 'InsufficientBalance')
        .withArgs(holderAddress, amount);
      const balance = await this.contract.balances(user1.address);
      expect(balance).equal(0);
    });

    it('Reverts if the consumeReasonCode value is false in the mapping', async function () {
      const amount = 100;
      await this.contract.connect(depositor).deposit(user1.address, amount, this.depositReasonCode);

      const holderAddress = user1.address;
      const spenderAddress = spender.address;
      const reasonCode = '0x0000000000000000000000000000000000000000000000000000000000000009';
      const deadline = 999999999999999;
      const messageHash = await this.contract.preparePayload(holderAddress, spenderAddress, amount, reasonCode, deadline);
      const signature = await user1.signMessage(ethers.getBytes(messageHash));
      const {v, r, s} = ethers.Signature.from(signature);

      await expect(this.contract.connect(spender).consume(user1.address, amount, reasonCode, deadline, spender.address, v, r, s))
        .to.revertedWithCustomError(this.contract, 'ConsumeReasonCodeDoesNotExist')
        .withArgs(reasonCode);
    });

    context('when successful', function () {
      it('it should update to correct balance', async function () {
        const amount = 100;
        await this.contract.connect(depositor).deposit(user1.address, amount, this.depositReasonCode);

        await this.contract.connect(admin).addConsumeReasonCodes(this.allowedConsumeReasonCodes);

        const holderAddress = user1.address;
        const spenderAddress = spender.address;
        const reasonCode = this.allowedConsumeReasonCodes[0];
        const deadline = 999999999999999;
        const messageHash = await this.contract.preparePayload(holderAddress, spenderAddress, amount, reasonCode, deadline);
        const signature = await user1.signMessage(ethers.getBytes(messageHash));
        const {v, r, s} = ethers.Signature.from(signature);

        await this.contract.connect(spender).consume(holderAddress, amount, this.allowedConsumeReasonCodes[0], deadline, spenderAddress, v, r, s);
        const balance = await this.contract.balances(holderAddress);
        expect(balance).equal(0);
      });

      it('it should emit an Comsumed event', async function () {
        const amount = 100;
        await this.contract.connect(depositor).deposit(user1.address, amount, this.depositReasonCode);

        await this.contract.connect(admin).addConsumeReasonCodes(this.allowedConsumeReasonCodes);

        const holderAddress = user1.address;
        const spenderAddress = spender.address;
        const reasonCode = this.allowedConsumeReasonCodes[0];
        const deadline = 999999999999999;
        const messageHash = await this.contract.preparePayload(holderAddress, spenderAddress, amount, reasonCode, deadline);
        const signature = await user1.signMessage(ethers.getBytes(messageHash));
        const {v, r, s} = ethers.Signature.from(signature);

        await expect(
          this.contract.connect(spender).consume(holderAddress, amount, this.allowedConsumeReasonCodes[0], deadline, spenderAddress, v, r, s)
        )
          .to.emit(this.contract, 'Consumed')
          .withArgs(spenderAddress, reasonCode, holderAddress, amount);
      });
    });
  });

  describe('consume(uint256 amount, bytes32 consumeReasonCode)', function () {
    it('Reverts if sender does not have enough balance', async function () {
      const amount = 100;
      const reasonCode = this.allowedConsumeReasonCodes[0];

      await expect(this.contract.connect(user1).consume(amount, reasonCode))
        .to.revertedWithCustomError(this.contract, 'InsufficientBalance')
        .withArgs(user1.address, amount);
    });

    it('Reverts if the consumeReasonCode value is false in the mapping', async function () {
      const amount = 100;
      await this.contract.connect(depositor).deposit(user1.address, amount, this.depositReasonCode);
      const reasonCode = '0x0000000000000000000000000000000000000000000000000000000000000009';

      await expect(this.contract.connect(user1).consume(amount, reasonCode))
        .to.revertedWithCustomError(this.contract, 'ConsumeReasonCodeDoesNotExist')
        .withArgs(reasonCode);
    });

    context('when successful', function () {
      it('it should update to correct balance', async function () {
        const amount = 100;
        await this.contract.connect(depositor).deposit(user1.address, amount, this.depositReasonCode);

        await this.contract.connect(admin).addConsumeReasonCodes(this.allowedConsumeReasonCodes);

        const reasonCode = this.allowedConsumeReasonCodes[0];

        await this.contract.connect(user1).consume(amount, reasonCode);
        const balance = await this.contract.balances(user1.address);
        expect(balance).equal(0);
      });

      it('it should emit an Comsumed event', async function () {
        const amount = 100;
        await this.contract.connect(depositor).deposit(user1.address, amount, this.depositReasonCode);

        await this.contract.connect(admin).addConsumeReasonCodes(this.allowedConsumeReasonCodes);

        const reasonCode = this.allowedConsumeReasonCodes[0];

        await expect(this.contract.connect(user1).consume(amount, reasonCode))
          .to.emit(this.contract, 'Consumed')
          .withArgs(user1.address, reasonCode, user1.address, amount);
      });
    });
  });

  describe('consume(address holder, uint256 amount, bytes32 consumeReasonCode)', function () {
    it('Reverts if sender does not have Spender role', async function () {
      const amount = 100;
      await this.contract.connect(depositor).deposit(user1.address, amount, this.depositReasonCode);
      const reasonCode = this.allowedConsumeReasonCodes[0];
      await this.contract.connect(admin).addConsumeReasonCodes(this.allowedConsumeReasonCodes);

      await expect(this.contract.connect(other).consume(user1.address, amount, reasonCode, ethers.Typed.overrides({})))
        .to.revertedWithCustomError(this.contract, 'NotRoleHolder')
        .withArgs(await this.contract.SPENDER_ROLE(), other.address);
    });

    it('Reverts if holder does not have enough balance', async function () {
      const amount = 100;
      const reasonCode = this.allowedConsumeReasonCodes[0];
      await this.contract.connect(admin).addConsumeReasonCodes(this.allowedConsumeReasonCodes);

      await expect(this.contract.connect(spender).consume(user1.address, amount, reasonCode, ethers.Typed.overrides({})))
        .to.revertedWithCustomError(this.contract, 'InsufficientBalance')
        .withArgs(user1.address, amount);
    });

    it('Reverts if the consumeReasonCode value is false in the mapping', async function () {
      const amount = 100;
      await this.contract.connect(depositor).deposit(user1.address, amount, this.depositReasonCode);
      const reasonCode = this.allowedConsumeReasonCodes[0];

      await expect(this.contract.connect(spender).consume(user1.address, amount, reasonCode, ethers.Typed.overrides({})))
        .to.revertedWithCustomError(this.contract, 'ConsumeReasonCodeDoesNotExist')
        .withArgs(reasonCode);
    });

    context('when successful', function () {
      it('it should update to correct balance', async function () {
        const amount = 100;
        await this.contract.connect(depositor).deposit(user1.address, amount, this.depositReasonCode);

        await this.contract.connect(admin).addConsumeReasonCodes(this.allowedConsumeReasonCodes);

        const reasonCode = this.allowedConsumeReasonCodes[0];

        await this.contract.connect(spender).consume(user1.address, amount, reasonCode, ethers.Typed.overrides({}));
        const balance = await this.contract.balances(user1.address);
        expect(balance).equal(0);
      });

      it('it should emit an Comsumed event', async function () {
        const amount = 100;
        await this.contract.connect(depositor).deposit(user1.address, amount, this.depositReasonCode);

        await this.contract.connect(admin).addConsumeReasonCodes(this.allowedConsumeReasonCodes);

        const reasonCode = this.allowedConsumeReasonCodes[0];

        await expect(this.contract.connect(spender).consume(user1.address, amount, reasonCode, ethers.Typed.overrides({})))
          .to.emit(this.contract, 'Consumed')
          .withArgs(spender.address, reasonCode, user1.address, amount);
      });
    });
  });

  describe('preparePayload(address holder, address spender, uint256 amount, bytes32 reasonCode, uint256 deadline)', function () {
    it('returns encoded Payload', async function () {
      const holderSpenderHash = ethers.solidityPackedKeccak256(['address', 'address'], [user1.address, spender.address]);
      const nonce = await this.contract.nonces(holderSpenderHash);
      const amount = 100;
      const reasonCode = this.allowedConsumeReasonCodes[0];
      const deadline = 999999999999999;

      const payload = await this.contract.preparePayload(user1.address, spender.address, amount, reasonCode, deadline);
      const expectedPayload = ethers.solidityPackedKeccak256(
        ['address', 'address', 'uint256', 'bytes32', 'uint256', 'uint256'],
        [user1.address, spender.address, amount, reasonCode, deadline, nonce]
      );
      expect(payload).to.equal(expectedPayload);
    });
  });

  context('support meta-transactions', function () {
    it('mock: _msgData()', async function () {
      // Arrange
      const forwarderRegistryAddress = await getForwarderRegistryAddress();
      this.contract = await deployContract('PointsMock', forwarderRegistryAddress);

      // Act

      // Assert

      expect(await this.contract.connect(user1).__msgData()).to.be.exist;
    });

    it('mock: _msgSender()', async function () {
      // Arrange
      const forwarderRegistryAddress = await getForwarderRegistryAddress();
      this.contract = await deployContract('PointsMock', forwarderRegistryAddress);

      // Act

      // Assert
      expect(await this.contract.connect(user1).__msgSender()).to.be.exist;
    });
  });
});
