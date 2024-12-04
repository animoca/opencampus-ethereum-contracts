const {ethers} = require('hardhat');
const {expect} = require('chai');
const {parseUnits, parseEther, MaxInt256, keccak256, toUtf8Bytes, ZeroHash} = require('ethers');
const {mine} = require('@nomicfoundation/hardhat-network-helpers');

const {deployContract, deployContractFromPath} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {getForwarderRegistryAddress, getTokenMetadataResolverPerTokenAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');

describe('EDUNodeRewards', function () {
  const REWARDS_CONTROLLER_ROLE = keccak256(toUtf8Bytes('REWARDS_CONTROLLER_ROLE'));
  const DELEGATE_REGISTRY_ADDRESS = '0x00000000000000447e69651d841bD8D104Bed493';
  const REWARD_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

  const attestationPeriod = 20n * 60n;
  const maxRewardTimeWindow = attestationPeriod;
  const rewardPerSecond = parseUnits('10000', 'gwei');

  let deployer, oracle, adminRewardController, rewardController, adminKycController, kycController, kycUser, nonKycUser, other;
  before(async function () {
    [deployer, oracle, adminRewardController, rewardController, adminKycController, kycController, kycUser, nonKycUser, other] =
      await ethers.getSigners();
  });

  const fixture = async function () {
    const metadataResolverAddress = await getTokenMetadataResolverPerTokenAddress();
    const forwarderRegistryAddress = await getForwarderRegistryAddress();

    this.nodeKeyContract = await deployContract('EDUNodeKey', 'EDU Principal Node Key', 'EDUKey', metadataResolverAddress, forwarderRegistryAddress);
    await this.nodeKeyContract.grantRole(await this.nodeKeyContract.OPERATOR_ROLE(), deployer.address);
    await this.nodeKeyContract.connect(deployer).batchMint(kycUser.address, [1n, 2n, 3n]);
    await this.nodeKeyContract.connect(deployer).batchMint(nonKycUser.address, [10n, 11n, 12n]);

    const refereeImplementation = await deployContract('RefereeMock');
    this.refereeContract = await ethers.getContractAt(
      'RefereeMock',
      await deployContractFromPath(
        'EIP173ProxyWithReceive',
        'node_modules/hardhat-deploy/extendedArtifacts',
        refereeImplementation,
        deployer,
        refereeImplementation.interface.encodeFunctionData('initialize', [
          attestationPeriod,
          await this.nodeKeyContract.getAddress(),
          forwarderRegistryAddress,
        ])
      )
    );

    this.nodeRewardsContract = await deployContract(
      'EDUNodeRewards',
      maxRewardTimeWindow,
      this.refereeContract,
      this.nodeKeyContract,
      REWARD_TOKEN,
      rewardPerSecond,
      adminRewardController.address,
      adminKycController.address,
      rewardController.address,
      kycController.address
    );

    // TODO: confirm if we should include mock delegate registry in the repo
    this.delegateRegistry = await ethers.getContractAt('IDelegateRegistry', DELEGATE_REGISTRY_ADDRESS);

    await this.nodeRewardsContract.connect(kycController).addKycWallets([kycUser.address]);

    await deployer.sendTransaction({to: this.nodeRewardsContract, value: parseEther('10')});

    await this.refereeContract.setNodeRewards(this.nodeRewardsContract);
    await this.refereeContract.setOracle(oracle, true);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  context('setRewardPerSecond(uint256)', function () {
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
    const batchNumber = 1n;
    const nodeKeyId = 1n;
    const validL2StateRoot = keccak256('0x000001');

    it('successfully set reward recipient as node key owner', async function () {
      await this.refereeContract.connect(kycUser).attest(batchNumber, validL2StateRoot, nodeKeyId);
      expect(await this.nodeRewardsContract.rewardsRecipients(batchNumber, nodeKeyId)).to.equal(kycUser.address);
    });

    it('successfully set reward recipient as node key owner instead of the delegated wallet', async function () {
      await this.delegateRegistry.connect(kycUser).delegateERC721(other.address, await this.nodeKeyContract.getAddress(), nodeKeyId, ZeroHash, true);
      await this.refereeContract.connect(kycUser).attest(batchNumber, validL2StateRoot, nodeKeyId);
      expect(await this.nodeRewardsContract.rewardsRecipients(batchNumber, nodeKeyId)).to.equal(kycUser.address);
    });
  });

  context('onBatchAttest(uint256 _batchNumber, uint256[] calldata _nodeKeyIds) external', function () {
    const batchNumber = 1n;
    const nodeKeyIds = [1n, 2n];
    const validL2StateRoot = keccak256('0x000001');

    it('successfully set reward recipient as node key owner', async function () {
      await this.refereeContract.connect(kycUser).batchAttest(batchNumber, validL2StateRoot, nodeKeyIds);
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
      const batchNumber = 1n;
      const validL2StateRoot = keccak256('0x000001');

      let l1NodeConfirmedTimestamp;
      let latestFinalizedBatchNumber;
      let prevL1NodeConfirmedTimestamp;

      beforeEach(async function () {
        l1NodeConfirmedTimestamp = BigInt((await ethers.provider.getBlock('latest')).timestamp);
        latestFinalizedBatchNumber = await this.refereeContract.latestFinalizedBatchNumber();
        prevL1NodeConfirmedTimestamp = (await this.refereeContract.getBatchInfo(latestFinalizedBatchNumber))[1];
      });

      it('reverts if called by non referee', async function () {
        await expect(
          this.nodeRewardsContract.connect(deployer).onFinalize(batchNumber, l1NodeConfirmedTimestamp, prevL1NodeConfirmedTimestamp, 1)
        ).to.be.revertedWithCustomError(this.nodeRewardsContract, 'OnlyReferee');
      });

      it('successfully set reward amount', async function () {
        const nodeKeyId = 1n;

        await this.refereeContract.connect(kycUser).attest(batchNumber, validL2StateRoot, nodeKeyId);
        await this.refereeContract.connect(oracle).finalize(batchNumber, l1NodeConfirmedTimestamp, validL2StateRoot);

        const dt = l1NodeConfirmedTimestamp - prevL1NodeConfirmedTimestamp;
        const rewardTimeWindow = maxRewardTimeWindow > dt ? dt : maxRewardTimeWindow;
        const reward = rewardTimeWindow * rewardPerSecond;

        expect(await this.nodeRewardsContract.rewardPerNodeKeyOfBatch(batchNumber)).to.equal(reward);
      });

      it('successfully set reward amount for multiple successful attestations', async function () {
        const nodeKeyIds = [1n, 2n, 3n];
        for (const nodeKeyId of nodeKeyIds) {
          await this.refereeContract.connect(kycUser).attest(batchNumber, validL2StateRoot, nodeKeyId);
        }
        await this.refereeContract.connect(oracle).finalize(batchNumber, l1NodeConfirmedTimestamp, validL2StateRoot);
        const dt = l1NodeConfirmedTimestamp - prevL1NodeConfirmedTimestamp;
        const rewardTimeWindow = maxRewardTimeWindow > dt ? dt : maxRewardTimeWindow;
        const reward = (rewardTimeWindow * rewardPerSecond) / BigInt(nodeKeyIds.length);

        expect(await this.nodeRewardsContract.rewardPerNodeKeyOfBatch(batchNumber)).to.equal(reward);
      });

      it('not setting reward amount if no successful attestations', async function () {
        await this.refereeContract.connect(oracle).finalize(batchNumber, l1NodeConfirmedTimestamp, validL2StateRoot);
        expect(await this.nodeRewardsContract.rewardPerNodeKeyOfBatch(batchNumber)).to.equal(0);
      });

      it('should assign reward time window to the minimum between L1 timestamp and the maximum reward window', async function () {
        const nodeKeyId = 1n;
        await this.refereeContract.connect(kycUser).attest(batchNumber, validL2StateRoot, nodeKeyId);
        await this.refereeContract.connect(oracle).finalize(batchNumber, l1NodeConfirmedTimestamp, validL2StateRoot);
        await mine(maxRewardTimeWindow - 10n);

        const latestBatchNumber = 2n;
        const latestL1NodeConfirmedTimestamp = BigInt((await ethers.provider.getBlock('latest')).timestamp);
        await this.refereeContract.connect(kycUser).attest(latestBatchNumber, validL2StateRoot, nodeKeyId);
        await this.refereeContract.connect(oracle).finalize(latestBatchNumber, latestL1NodeConfirmedTimestamp, validL2StateRoot);
        const rewardTimeWindow = latestL1NodeConfirmedTimestamp - l1NodeConfirmedTimestamp;
        const reward = rewardTimeWindow * rewardPerSecond;

        expect(await this.nodeRewardsContract.rewardPerNodeKeyOfBatch(latestBatchNumber)).to.equal(reward);
      });
    }
  );

  context('claimReward(uint256 _nodeKeyId, uint256[] calldata _batchNumbers) external', function () {
    it('reverts if called by non referee', async function () {
      await expect(this.nodeRewardsContract.connect(deployer).claimReward(1n, [1n])).to.be.revertedWithCustomError(
        this.nodeRewardsContract,
        'OnlyReferee'
      );
    });

    it('reverts if the recipient is not a KYC wallet', async function () {
      const batchNumber = 1n;
      const nodeKeyId = 10n;
      const validL2StateRoot = keccak256('0x000001');
      const l1NodeConfirmedTimestamp = BigInt((await ethers.provider.getBlock('latest')).timestamp);

      await this.refereeContract.connect(nonKycUser).attest(batchNumber, validL2StateRoot, nodeKeyId);
      await this.refereeContract.connect(oracle).finalize(batchNumber, l1NodeConfirmedTimestamp, validL2StateRoot);

      await expect(this.refereeContract.connect(nonKycUser).claimReward(nodeKeyId, 1)).to.be.revertedWithCustomError(
        this.nodeRewardsContract,
        'OnlyKycWallet'
      );
    });

    it('reverts for repeat claiming', async function () {
      const batchNumber = 1n;
      const nodeKeyId = 1n;
      const validL2StateRoot = keccak256('0x000001');
      const l1NodeConfirmedTimestamp = BigInt((await ethers.provider.getBlock('latest')).timestamp);

      await this.refereeContract.connect(kycUser).attest(batchNumber, validL2StateRoot, nodeKeyId);
      await this.refereeContract.connect(oracle).finalize(batchNumber, l1NodeConfirmedTimestamp, validL2StateRoot);
      await this.refereeContract.connect(kycUser).claimReward(nodeKeyId, 1);

      await expect(this.refereeContract.connect(kycUser).claimReward(nodeKeyId, 1)).to.be.revertedWithCustomError(
        this.refereeContract,
        'NoRewardsToClaim'
      );
    });

    context('when successful', function () {
      const batchNumber = 1n;
      const validL2StateRoot = keccak256('0x000001');

      let l1NodeConfirmedTimestamp;
      let latestFinalizedBatchNumber;
      let prevL1NodeConfirmedTimestamp;

      beforeEach(async function () {
        l1NodeConfirmedTimestamp = BigInt((await ethers.provider.getBlock('latest')).timestamp);
        latestFinalizedBatchNumber = await this.refereeContract.latestFinalizedBatchNumber();
        prevL1NodeConfirmedTimestamp = (await this.refereeContract.getBatchInfo(latestFinalizedBatchNumber))[1];
      });

      it('pay reward to a KYC wallet', async function () {
        const nodeKeyId = 1n;

        await this.refereeContract.connect(kycUser).attest(batchNumber, validL2StateRoot, nodeKeyId);
        await this.refereeContract.connect(oracle).finalize(batchNumber, l1NodeConfirmedTimestamp, validL2StateRoot);
        const dt = l1NodeConfirmedTimestamp - prevL1NodeConfirmedTimestamp;
        const rewardTimeWindow = maxRewardTimeWindow > dt ? dt : maxRewardTimeWindow;
        const reward = rewardTimeWindow * rewardPerSecond;

        const prevBalance = await ethers.provider.getBalance(kycUser.address);
        const tx = await this.refereeContract.connect(kycUser).claimReward(nodeKeyId, 1);
        const receipt = await tx.wait();
        const newBalance = await ethers.provider.getBalance(kycUser.address);

        const gasUsed = receipt.gasUsed;
        const gasPrice = receipt.gasPrice;
        const gasCost = gasUsed * gasPrice;

        expect(newBalance - prevBalance).to.equal(reward - gasCost);
      });

      it('pay reward to the node key owner instead of the delegated wallet', async function () {
        const nodeKeyId = 1n;

        await this.delegateRegistry
          .connect(kycUser)
          .delegateERC721(other.address, await this.nodeKeyContract.getAddress(), nodeKeyId, ZeroHash, true);
        await this.refereeContract.connect(other).attest(batchNumber, validL2StateRoot, nodeKeyId);
        await this.refereeContract.connect(oracle).finalize(batchNumber, l1NodeConfirmedTimestamp, validL2StateRoot);
        const dt = l1NodeConfirmedTimestamp - prevL1NodeConfirmedTimestamp;
        const rewardTimeWindow = maxRewardTimeWindow > dt ? dt : maxRewardTimeWindow;
        const reward = rewardTimeWindow * rewardPerSecond;

        const prevBalance = await ethers.provider.getBalance(kycUser.address);
        const tx = await this.refereeContract.connect(kycUser).claimReward(nodeKeyId, 1);
        const receipt = await tx.wait();
        const newBalance = await ethers.provider.getBalance(kycUser.address);

        const gasUsed = receipt.gasUsed;
        const gasPrice = receipt.gasPrice;
        const gasCost = gasUsed * gasPrice;

        expect(newBalance - prevBalance).to.equal(reward - gasCost);
      });

      it('pay the node key owner at attestation, even if the key is transferred before claiming', async function () {
        const nodeKeyId = 1n;

        await this.refereeContract.connect(kycUser).attest(batchNumber, validL2StateRoot, nodeKeyId);
        await this.refereeContract.connect(oracle).finalize(batchNumber, l1NodeConfirmedTimestamp, validL2StateRoot);
        const dt = l1NodeConfirmedTimestamp - prevL1NodeConfirmedTimestamp;
        const rewardTimeWindow = maxRewardTimeWindow > dt ? dt : maxRewardTimeWindow;
        const reward = rewardTimeWindow * rewardPerSecond;

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

        await this.refereeContract.connect(kycUser).attest(batchNumber, validL2StateRoot, nodeKeyId);
        await this.refereeContract.connect(oracle).finalize(batchNumber, l1NodeConfirmedTimestamp, validL2StateRoot);
        const dt = l1NodeConfirmedTimestamp - prevL1NodeConfirmedTimestamp;
        const rewardTimeWindow = maxRewardTimeWindow > dt ? dt : maxRewardTimeWindow;
        const reward = rewardTimeWindow * rewardPerSecond;

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
