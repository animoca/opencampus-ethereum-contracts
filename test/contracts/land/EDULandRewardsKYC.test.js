const {ethers, network} = require('hardhat');
const {expect} = require('chai');
const {parseEther, keccak256, toUtf8Bytes} = require('ethers');

const {deployContract, deployContractFromPath} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {deployTokenMetadataResolverWithBaseURI, getForwarderRegistryAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');

describe('EDULandRewardsKYC', function () {
  const REWARDS_CONTRACT_KYC_CONTROLLER_ROLE = keccak256(toUtf8Bytes('KYC_CONTROLLER_ROLE'));
  const OPERATOR_ROLE = keccak256(toUtf8Bytes('OPERATOR_ROLE'));

  let deployer, operator, messageSigner, messageSigner2, user, user2, other;
  before(async function () {
    [deployer, operator, messageSigner, messageSigner2, user, user2, other] = await ethers.getSigners();
  });

  const fixture = async function () {
    const metadataResolverAddress = await deployTokenMetadataResolverWithBaseURI();
    const forwarderRegistryAddress = await getForwarderRegistryAddress();
    const landContract = await deployContract('EDULand', 'EDU Land', 'EDULand', metadataResolverAddress);
    const refereeImplementation = await deployContract('RefereeMock', landContract);
    const refereeContract = await ethers.getContractAt(
      'RefereeMock',
      await deployContractFromPath(
        'EIP173ProxyWithReceive',
        'node_modules/hardhat-deploy/extendedArtifacts',
        refereeImplementation,
        deployer.address,
        '0x'
      )
    );
    this.nodeRewardsContract = await deployContract(
      'EDULandRewards',
      20n * 60n, // 20 minutes max reward time window
      refereeContract,
      landContract,
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // reward token
      parseEther('0.01'), // reward per second
      deployer
    );

    this.contract = await deployContract('EDULandRewardsKYCMock', messageSigner, this.nodeRewardsContract, forwarderRegistryAddress);
    await this.nodeRewardsContract.connect(deployer).grantRole(REWARDS_CONTRACT_KYC_CONTROLLER_ROLE, this.contract);
    await this.contract.grantRole(OPERATOR_ROLE, operator.address);

    this.signTypedMessageDomain = {
      name: 'EDULandRewardsKYC',
      version: '1.0',
      chainId: network.config.chainId,
      verifyingContract: await this.contract.getAddress(),
    };
    this.signTypedMessageTypes = {
      addKycWalletWithSignature: [
        {name: 'wallet', type: 'address'},
        {name: 'expireAt', type: 'uint256'},
      ],
    };
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  context('constructor', function () {
    it('sets the message sender', async function () {
      expect(await this.contract.messageSigner()).to.equal(messageSigner.address);
    });

    it('sets the node rewards contract', async function () {
      expect(await this.contract.EDU_LAND_REWARDS()).to.equal(this.nodeRewardsContract);
    });
  });

  context('addKycWalletWithSignature(address,uint256,bytes)', function () {
    it('reverts if signature expires', async function () {
      const blockTimestamp = (await ethers.provider.getBlock('latest')).timestamp;
      const signature = await messageSigner.signTypedData(this.signTypedMessageDomain, this.signTypedMessageTypes, {
        wallet: user.address,
        expireAt: blockTimestamp,
      });
      await expect(this.contract.addKycWalletWithSignature(user.address, blockTimestamp, signature))
        .to.be.revertedWithCustomError(this.contract, 'ExpiredSignature')
        .withArgs(user.address, blockTimestamp, signature);
    });

    it("reverts if reward KYC contract doesn't have kyc controller role in rewards contract", async function () {
      await this.nodeRewardsContract.connect(deployer).revokeRole(REWARDS_CONTRACT_KYC_CONTROLLER_ROLE, this.contract);

      const blockTimestamp = (await ethers.provider.getBlock('latest')).timestamp;
      const expireAt = blockTimestamp + 60; // 1 minute
      const signature = await messageSigner.signTypedData(this.signTypedMessageDomain, this.signTypedMessageTypes, {
        wallet: user.address,
        expireAt,
      });
      await expect(this.contract.addKycWalletWithSignature(user.address, expireAt, signature)).to.be.revertedWith(
        `AccessControl: account ${(await this.contract.getAddress()).toLowerCase()} is missing role ${REWARDS_CONTRACT_KYC_CONTROLLER_ROLE}`
      );
    });

    it('reverts if signature is invalid (invalid signer)', async function () {
      const blockTimestamp = (await ethers.provider.getBlock('latest')).timestamp;
      const expireAt = blockTimestamp + 60; // 1 minute
      const signature = await user.signTypedData(this.signTypedMessageDomain, this.signTypedMessageTypes, {
        wallet: user.address,
        expireAt,
      });
      await expect(this.contract.addKycWalletWithSignature(user.address, expireAt, signature))
        .to.be.revertedWithCustomError(this.contract, 'InvalidSignature')
        .withArgs(user.address, expireAt, signature);
    });

    it('reverts if signature is invalid (invalid message data)', async function () {
      const blockTimestamp = (await ethers.provider.getBlock('latest')).timestamp;
      const expireAt = blockTimestamp + 60; // 1 minute
      const signature = await messageSigner.signTypedData(this.signTypedMessageDomain, this.signTypedMessageTypes, {
        wallet: other.address,
        expireAt,
      });
      await expect(this.contract.addKycWalletWithSignature(user.address, expireAt, signature))
        .to.be.revertedWithCustomError(this.contract, 'InvalidSignature')
        .withArgs(user.address, expireAt, signature);
    });

    it('reverts if signature is invalid (invalid message type)', async function () {
      const blockTimestamp = (await ethers.provider.getBlock('latest')).timestamp;
      const expireAt = blockTimestamp + 60; // 1 minute
      const invalidDomain = {
        ...this.signTypedMessageDomain,
        verifyingContract: await this.nodeRewardsContract.getAddress(),
      };
      const signature = await messageSigner.signTypedData(invalidDomain, this.signTypedMessageTypes, {
        wallet: other.address,
        expireAt,
      });
      await expect(this.contract.addKycWalletWithSignature(user.address, expireAt, signature))
        .to.be.revertedWithCustomError(this.contract, 'InvalidSignature')
        .withArgs(user.address, expireAt, signature);
    });

    it('successfully adds a kyc wallet', async function () {
      const blockTimestamp = (await ethers.provider.getBlock('latest')).timestamp;
      const expireAt = blockTimestamp + 60; // 1 minute
      const signature = await messageSigner.signTypedData(this.signTypedMessageDomain, this.signTypedMessageTypes, {
        wallet: user.address,
        expireAt,
      });
      await expect(this.contract.addKycWalletWithSignature(user.address, expireAt, signature))
        .to.emit(this.contract, 'KycWalletsAdded')
        .withArgs([user.address]);
      expect(await this.nodeRewardsContract.isKycWallet(user.address)).to.be.true;
    });
  });

  context('addKycWallets(address[])', function () {
    it('reverts if it is not called by the operator', async function () {
      await expect(this.contract.addKycWallets([user.address]))
        .to.be.revertedWithCustomError(this.contract, 'NotRoleHolder')
        .withArgs(OPERATOR_ROLE, deployer.address);
    });

    it('successfully adds a kyc wallet', async function () {
      await expect(this.contract.connect(operator).addKycWallets([user.address]))
        .to.emit(this.contract, 'KycWalletsAdded')
        .withArgs([user.address]);
      expect(await this.nodeRewardsContract.isKycWallet(user.address)).to.be.true;
    });

    it('successfully adds multiple kyc wallets', async function () {
      await expect(this.contract.connect(operator).addKycWallets([user.address, user2.address]))
        .to.emit(this.contract, 'KycWalletsAdded')
        .withArgs([user.address, user2.address]);
      expect(await this.nodeRewardsContract.isKycWallet(user.address)).to.be.true;
      expect(await this.nodeRewardsContract.isKycWallet(user2.address)).to.be.true;
    });
  });

  context('removeKycWallets(address[])', function () {
    beforeEach(async function () {
      await this.contract.connect(operator).addKycWallets([user.address, user2.address]);
    });

    it('reverts if it is not called by the operator', async function () {
      await expect(this.contract.removeKycWallets([user.address]))
        .to.be.revertedWithCustomError(this.contract, 'NotRoleHolder')
        .withArgs(OPERATOR_ROLE, deployer.address);
    });

    it('successfully removes a kyc wallet', async function () {
      await expect(this.contract.connect(operator).removeKycWallets([user.address]))
        .to.emit(this.contract, 'KycWalletsRemoved')
        .withArgs([user.address]);
      expect(await this.nodeRewardsContract.isKycWallet(user.address)).to.be.false;
    });

    it('successfully removes multiple kyc wallets', async function () {
      await expect(this.contract.connect(operator).removeKycWallets([user.address, user2.address]))
        .to.emit(this.contract, 'KycWalletsRemoved')
        .withArgs([user.address, user2.address]);
      expect(await this.nodeRewardsContract.isKycWallet(user.address)).to.be.false;
      expect(await this.nodeRewardsContract.isKycWallet(user2.address)).to.be.false;
    });
  });

  context('setMessageSigner(address)', function () {
    it('reverts if it is not called by the owner', async function () {
      await expect(this.contract.connect(other).setMessageSigner(messageSigner2.address))
        .to.be.revertedWithCustomError(this.contract, 'NotContractOwner')
        .withArgs(other.address);
    });

    it('successfully set the new message signer', async function () {
      await expect(this.contract.setMessageSigner(messageSigner2.address))
        .to.emit(this.contract, 'MessageSignerSet')
        .withArgs(messageSigner2.address);
      expect(await this.contract.messageSigner()).to.equal(messageSigner2.address);
    });
  });

  context('Meta transaction', function () {
    it('returns the msg.sender', async function () {
      await this.contract.__msgSender();
    });

    it('returns the msg.data', async function () {
      await this.contract.__msgData();
    });
  });
});
