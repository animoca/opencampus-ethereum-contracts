const {ethers} = require('hardhat');
const {expect} = require('chai');
const {parseEther, keccak256, toUtf8Bytes} = require('ethers');
const {mine} = require('@nomicfoundation/hardhat-network-helpers');

const {deployContract, deployContractFromPath} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {getForwarderRegistryAddress, getTokenMetadataResolverPerTokenAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');

describe('EDULandRewards', function () {
  const REWARDS_CONTROLLER_ROLE = keccak256(toUtf8Bytes('REWARDS_CONTROLLER_ROLE'));
  const KYC_CONTROLLER_ROLE = keccak256(toUtf8Bytes('KYC_CONTROLLER_ROLE'));
  const OWNER_ROLE = keccak256(toUtf8Bytes('OWNER_ROLE'));
  const REWARD_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

  const maxRewardTimeWindow = 20n * 60n; // 20 minutes
  const rewardPerSecond = parseEther('0.1');

  let deployer, rewardController, kycController, kycUser, nonKycUser, other;
  before(async function () {
    [deployer, rewardController, kycController, kycUser, nonKycUser, other] = await ethers.getSigners();
  });

  const fixture = async function () {
    const metadataResolverAddress = await getTokenMetadataResolverPerTokenAddress();
    const forwarderRegistryAddress = await getForwarderRegistryAddress();

    this.nodeKeyContract = await deployContract('EDULand', 'EDU Principal Node Key', 'EDUKey', metadataResolverAddress, forwarderRegistryAddress);
    await this.nodeKeyContract.grantRole(await this.nodeKeyContract.OPERATOR_ROLE(), deployer.address);
    await this.nodeKeyContract.connect(deployer).batchMint(kycUser.address, [1n, 2n, 3n]);
    await this.nodeKeyContract.connect(deployer).batchMint(nonKycUser.address, [10n, 11n, 12n]);

    const refereeImplementation = await deployContract('RefereeMock', this.nodeKeyContract);
    this.refereeContract = await ethers.getContractAt(
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
      maxRewardTimeWindow,
      this.refereeContract,
      this.nodeKeyContract,
      REWARD_TOKEN,
      rewardPerSecond,
      deployer
    );
    // Grant NodeRewards’ KYC controller role to operator wallet
    await this.nodeRewardsContract.connect(deployer).grantRole(KYC_CONTROLLER_ROLE, kycController.address);
    await this.nodeRewardsContract.connect(kycController).addKycWallets([kycUser.address]);

    // Grant NodeRewards’ Reward controller role to operator wallet
    await this.nodeRewardsContract.connect(deployer).grantRole(REWARDS_CONTROLLER_ROLE, rewardController.address);

    await deployer.sendTransaction({to: this.nodeRewardsContract, value: parseEther('1000')});

    await this.refereeContract.setNodeRewards(this.nodeRewardsContract);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  describe('constructor', function () {
    it('sets the max reward time window', async function () {
      expect(await this.nodeRewardsContract.MAX_REWARD_TIME_WINDOW()).to.be.equal(maxRewardTimeWindow);
    });

    it('sets the reward per second', async function () {
      expect(await this.nodeRewardsContract.rewardPerSecond()).to.be.equal(rewardPerSecond);
    });

    it('sets the referee contract', async function () {
      expect(await this.nodeRewardsContract.REFEREE()).to.be.equal(await this.refereeContract.getAddress());
    });

    it('sets the node key contract', async function () {
      expect(await this.nodeRewardsContract.NODE_KEY()).to.be.equal(await this.nodeKeyContract.getAddress());
    });

    it('sets the reward token contract', async function () {
      expect(await this.nodeRewardsContract.REWARD_TOKEN()).to.be.equal(REWARD_TOKEN);
    });

    it('sets the owner', async function () {
      expect(await this.nodeRewardsContract.hasRole(OWNER_ROLE, deployer.address)).to.be.true;
    });

    it("sets the owner role's admin to be owner role", async function () {
      expect(await this.nodeRewardsContract.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
    });

    it("sets the reward controller role's admin to be owner role", async function () {
      expect(await this.nodeRewardsContract.getRoleAdmin(REWARDS_CONTROLLER_ROLE)).to.equal(OWNER_ROLE);
    });

    it("sets the kyc controller role's admin to be owner role", async function () {
      expect(await this.nodeRewardsContract.getRoleAdmin(KYC_CONTROLLER_ROLE)).to.equal(OWNER_ROLE);
    });
  });

  context('addKycWallets(address[] calldata _wallets) external', function () {
    it('reverts if called by non reward controller', async function () {
      await expect(this.nodeRewardsContract.connect(deployer).addKycWallets([other])).to.be.revertedWith(
        `AccessControl: account ${deployer.address.toLowerCase()} is missing role ${KYC_CONTROLLER_ROLE}`
      );
    });

    it('successfully sets reward per second', async function () {
      await this.nodeRewardsContract.connect(kycController).addKycWallets([other]);
      expect(await this.nodeRewardsContract.getKycWallets()).to.include(other.address);
    });
  });

  context('setRewardPerSecond(uint256 rewardPerSecond_) external', function () {
    it('reverts if called by non reward controller', async function () {
      await expect(this.nodeRewardsContract.connect(deployer).setRewardPerSecond(1000)).to.be.revertedWith(
        `AccessControl: account ${deployer.address.toLowerCase()} is missing role ${REWARDS_CONTROLLER_ROLE}`
      );
    });

    it('successfully sets reward per second', async function () {
      await this.nodeRewardsContract.connect(rewardController).setRewardPerSecond(1000);
      expect(await this.nodeRewardsContract.rewardPerSecond()).to.equal(1000);
    });
  });

  context('onAttest(uint256 _batchNumber, uint256 _nodeKeyId) external', function () {
    it('successfully set reward recipient as node key owner', async function () {
      const batchNumber = (await this.refereeContract.latestFinalizedBatchNumber()) + 1n;
      const nodeKeyId = 1n;
      await this.refereeContract.connect(kycUser).attest(batchNumber, nodeKeyId);
      expect(await this.nodeRewardsContract.rewardsRecipients(batchNumber, nodeKeyId)).to.equal(kycUser.address);
    });
  });

  context('onBatchAttest(uint256 _batchNumber, uint256[] calldata _nodeKeyIds) external', function () {
    it('successfully set reward recipient as node key owner', async function () {
      const batchNumber = (await this.refereeContract.latestFinalizedBatchNumber()) + 1n;
      const nodeKeyIds = [1n, 2n];
      await this.refereeContract.connect(kycUser).batchAttest(batchNumber, nodeKeyIds);
      for (const nodeKeyId of nodeKeyIds) {
        expect(await this.nodeRewardsContract.rewardsRecipients(batchNumber, nodeKeyId)).to.equal(kycUser.address);
      }
    });
  });

  context(
    `onFinalize(
        uint256 _batchNumber,
        uint256 _l1NodeConfirmedTimestamp,
        uint256 _prevL1NodeConfirmedTimestamp,
        uint256 _nrOfSuccessfulAttestations
    ) external`,
    function () {
      let batchNumber;

      beforeEach(async function () {
        batchNumber = (await this.refereeContract.latestFinalizedBatchNumber()) + 1n;
      });

      it('reverts if called by non referee', async function () {
        await expect(this.nodeRewardsContract.connect(deployer).onFinalize(batchNumber, 2n, 1n, 1)).to.be.revertedWithCustomError(
          this.nodeRewardsContract,
          'OnlyReferee'
        );
      });

      it('successfully set reward amount', async function () {
        const nodeKeyId = 1n;

        await this.refereeContract.connect(kycUser).attest(batchNumber, nodeKeyId);
        await this.refereeContract.finalize();
        const reward = maxRewardTimeWindow * rewardPerSecond;

        expect(await this.nodeRewardsContract.rewardPerLandOfBatch(batchNumber)).to.equal(reward);
      });

      it('successfully set reward amount for multiple successful attestations', async function () {
        const nodeKeyIds = [1n, 2n, 3n];
        for (const nodeKeyId of nodeKeyIds) {
          await this.refereeContract.connect(kycUser).attest(batchNumber, nodeKeyId);
        }
        await this.refereeContract.finalize();
        const reward = (maxRewardTimeWindow * rewardPerSecond) / BigInt(nodeKeyIds.length);

        expect(await this.nodeRewardsContract.rewardPerLandOfBatch(batchNumber)).to.equal(reward);
      });

      it('not setting reward amount if no successful attestations', async function () {
        await this.refereeContract.finalize();
        expect(await this.nodeRewardsContract.rewardPerLandOfBatch(batchNumber)).to.equal(0);
      });

      it('should assign reward time window to the minimum between L1 timestamp and the maximum reward window', async function () {
        const nodeKeyId = 1n;
        await this.refereeContract.connect(kycUser).attest(batchNumber, nodeKeyId);
        await this.refereeContract.finalize();
        const lastL1NodeConfirmedTimestamp = await this.refereeContract.latestConfirmedTimestamp();
        await mine(maxRewardTimeWindow - 10n);

        const latestBatchNumber = 2n;
        await this.refereeContract.connect(kycUser).attest(latestBatchNumber, nodeKeyId);
        await this.refereeContract.finalize();
        const timestampOnFinalize = await this.refereeContract.latestConfirmedTimestamp();
        const rewardTimeWindow = timestampOnFinalize - lastL1NodeConfirmedTimestamp;
        const reward = rewardTimeWindow * rewardPerSecond;

        expect(await this.nodeRewardsContract.rewardPerLandOfBatch(latestBatchNumber)).to.equal(reward);
      });
    }
  );

  context('claimReward(uint256 _nodeKeyId, uint256[] calldata _batchNumbers) external', function () {
    let batchNumber;

    beforeEach(async function () {
      batchNumber = (await this.refereeContract.latestFinalizedBatchNumber()) + 1n;
    });

    it('reverts if called by non referee', async function () {
      await expect(this.nodeRewardsContract.connect(deployer).claimReward(1n, [1n])).to.be.revertedWithCustomError(
        this.nodeRewardsContract,
        'OnlyReferee'
      );
    });

    it('reverts if the recipient is not a KYC wallet', async function () {
      const nodeKeyId = 10n;
      await this.refereeContract.connect(nonKycUser).attest(batchNumber, nodeKeyId);
      await this.refereeContract.finalize();

      await expect(this.refereeContract.connect(nonKycUser).claimReward(nodeKeyId, 1)).to.be.revertedWithCustomError(
        this.nodeRewardsContract,
        'OnlyKycWallet'
      );
    });

    context('when successful', function () {
      it('pay reward to a KYC wallet and emit Claimed event', async function () {
        const nodeKeyId = 1n;

        await this.refereeContract.connect(kycUser).attest(batchNumber, nodeKeyId);
        await this.refereeContract.finalize();
        const reward = maxRewardTimeWindow * rewardPerSecond;

        const prevBalance = await ethers.provider.getBalance(kycUser.address);
        const txPromise = await this.refereeContract.connect(kycUser).claimReward(nodeKeyId, 1);
        const receipt = await (await txPromise).wait();
        const newBalance = await ethers.provider.getBalance(kycUser.address);

        const gasUsed = receipt.gasUsed;
        const gasPrice = receipt.gasPrice;
        const gasCost = gasUsed * gasPrice;

        await expect(txPromise).to.emit(this.nodeRewardsContract, 'Claimed').withArgs(kycUser.address, batchNumber, nodeKeyId, reward);
        expect(newBalance - prevBalance).to.equal(reward - gasCost);
      });

      it('pay reward to a KYC wallet for multiple attestations and emit multiple Claimed event', async function () {
        const nodeKeyId = 1n;

        // first batch attest and finalize
        await this.refereeContract.connect(kycUser).attest(batchNumber, nodeKeyId);
        await this.refereeContract.finalize();
        const timestampAfterFirstFinalize = await this.refereeContract.latestConfirmedTimestamp();
        const firstBatchReward = maxRewardTimeWindow * rewardPerSecond;

        // second batch attest and finalize
        const secondBatchNumber = (await this.refereeContract.latestFinalizedBatchNumber()) + 1n;
        await this.refereeContract.connect(kycUser).attest(secondBatchNumber, nodeKeyId);
        await this.refereeContract.finalize();
        const timestampOnSecondFinalize = await this.refereeContract.latestConfirmedTimestamp();
        const rewardTimeWindow = timestampOnSecondFinalize - timestampAfterFirstFinalize;
        const secondBatchReward = rewardTimeWindow * rewardPerSecond;

        // claim rewards
        const prevBalance = await ethers.provider.getBalance(kycUser.address);
        const txPromise = this.refereeContract.connect(kycUser).claimReward(nodeKeyId, 2);
        const receipt = await (await txPromise).wait();
        const newBalance = await ethers.provider.getBalance(kycUser.address);

        const gasUsed = receipt.gasUsed;
        const gasPrice = receipt.gasPrice;
        const gasCost = gasUsed * gasPrice;

        await expect(txPromise)
          .to.emit(this.nodeRewardsContract, 'Claimed')
          .withArgs(kycUser.address, batchNumber, nodeKeyId, firstBatchReward)
          .to.emit(this.nodeRewardsContract, 'Claimed')
          .withArgs(kycUser.address, secondBatchNumber, nodeKeyId, secondBatchReward);
        expect(newBalance - prevBalance).to.equal(firstBatchReward + secondBatchReward - gasCost);
      });

      it('pay the node key owner at attestation, even if the key is transferred before claiming', async function () {
        const nodeKeyId = 1n;

        await this.refereeContract.connect(kycUser).attest(batchNumber, nodeKeyId);
        await this.refereeContract.finalize();
        const reward = maxRewardTimeWindow * rewardPerSecond;

        await this.nodeKeyContract.connect(deployer).transferFrom(kycUser.address, other.address, nodeKeyId);

        const prevBalance = await ethers.provider.getBalance(kycUser.address);
        const tx = await this.refereeContract.connect(kycUser).claimReward(nodeKeyId, 1);
        const receipt = await tx.wait();
        const newBalance = await ethers.provider.getBalance(kycUser.address);

        const gasUsed = receipt.gasUsed;
        const gasPrice = receipt.gasPrice;
        const gasCost = gasUsed * gasPrice;

        expect(await this.nodeKeyContract.ownerOf(nodeKeyId)).to.equal(other.address);
        expect(newBalance - prevBalance).to.equal(reward - gasCost);
      });

      it('pay the node key owner at attestation, even if the key is burned before claiming', async function () {
        const nodeKeyId = 1n;

        await this.refereeContract.connect(kycUser).attest(batchNumber, nodeKeyId);
        await this.refereeContract.finalize();
        const reward = maxRewardTimeWindow * rewardPerSecond;

        await this.nodeKeyContract.connect(deployer).burnFrom(kycUser.address, nodeKeyId);

        const prevBalance = await ethers.provider.getBalance(kycUser.address);
        const tx = await this.refereeContract.connect(kycUser).claimReward(nodeKeyId, 1);
        const receipt = await tx.wait();
        const newBalance = await ethers.provider.getBalance(kycUser.address);

        const gasUsed = receipt.gasUsed;
        const gasPrice = receipt.gasPrice;
        const gasCost = gasUsed * gasPrice;

        expect(newBalance - prevBalance).to.equal(reward - gasCost);
      });
    });
  });
});
