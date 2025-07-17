const {ethers} = require('hardhat');
const {expect} = require('chai');
const {MerkleTree} = require('merkletreejs');

const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {getForwarderRegistryAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');
const helpers = require('@nomicfoundation/hardhat-network-helpers');

const {setupLimitedOCPointsMerkleClaim} = require('../setup');

describe('LimitedOCPointsMerkleClaim', function () {
  let deployer, owner, claimer1, claimer2, claimer3, claimer4, other;

  before(async function () {
    [deployer, owner, claimer1, claimer2, claimer3, claimer4, other] = await ethers.getSigners();
  });

  const fixture = async function () {
    await setupLimitedOCPointsMerkleClaim.call(this, deployer, owner);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);

    this.currentTime = await helpers.time.latest();
    this.startTime = this.currentTime + 100; // starts in 100 seconds
    this.endTime = this.startTime + 3600; // lasts for 1 hour
    this.totalAmount = 800n; // Changed from 1000n to 600n to test pool depletion
    this.epochId = 0n; // first epoch

    this.payouts = [
      {
        recipient: claimer1.address,
        amount: 100n,
        reasonCode: ethers.keccak256(ethers.toUtf8Bytes('SEASON1_DAPP1')),
        epochId: this.epochId,
      },
      {
        recipient: claimer2.address,
        amount: 200n,
        reasonCode: ethers.keccak256(ethers.toUtf8Bytes('SEASON1_DAPP2')),
        epochId: this.epochId,
      },
      {
        recipient: claimer3.address,
        amount: 300n,
        reasonCode: ethers.keccak256(ethers.toUtf8Bytes('OC_POINTS_MIGRATION')),
        epochId: this.epochId,
      },
      {
        recipient: claimer4.address,
        amount: 400n,
        reasonCode: ethers.keccak256(ethers.toUtf8Bytes('SEASON2_REWARD')),
        epochId: this.epochId,
      },
    ];

    this.leaves = this.payouts.map(({recipient, amount, reasonCode, epochId}) => {
      return ethers.solidityPacked(['address', 'uint256', 'bytes32', 'uint256'], [recipient, amount, reasonCode, epochId]);
    });
    this.tree = new MerkleTree(this.leaves, ethers.keccak256, {hashLeaves: true, sortPairs: true});
    this.root = this.tree.getHexRoot();
  });

  describe('constructor', function () {
    it('reverts with {InvalidPointsContractAddress} if the reward contract address is the zero address', async function () {
      await expect(deployContract('LimitedOCPointsMerkleClaim', ethers.ZeroAddress, await getForwarderRegistryAddress())).to.revertedWithCustomError(
        this.LimitedOCPointsMerkleClaim,
        'InvalidPointsContractAddress'
      );
    });

    context('when successful', function () {
      it('sets the forwarder registry address', async function () {
        expect(await this.LimitedOCPointsMerkleClaim.forwarderRegistry()).to.be.equal(await getForwarderRegistryAddress());
      });

      it('sets the reward contract address', async function () {
        expect(await this.LimitedOCPointsMerkleClaim.POINTS_CONTRACT()).to.be.equal(await this.PointsContract.getAddress());
      });

      it('initializes current epoch ID to 0', async function () {
        expect(await this.LimitedOCPointsMerkleClaim.currentEpochId()).to.be.equal(0n);
      });
    });
  });

  describe('setMerkleRoot(bytes32,uint256,uint256,uint256)', function () {
    it('reverts with {NotContractOwner} if not called by the contract owner', async function () {
      await expect(
        this.LimitedOCPointsMerkleClaim.connect(other).setMerkleRoot(this.root, this.totalAmount, this.startTime, this.endTime)
      ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'NotContractOwner');
    });

    it('reverts with {InvalidClaimWindow} if startTime is not before endTime', async function () {
      await expect(
        this.LimitedOCPointsMerkleClaim.connect(deployer).setMerkleRoot(this.root, this.totalAmount, this.endTime, this.startTime)
      ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'InvalidClaimWindow');
    });

    it('reverts with {InvalidClaimWindow} if startTime equals endTime', async function () {
      await expect(
        this.LimitedOCPointsMerkleClaim.connect(deployer).setMerkleRoot(this.root, this.totalAmount, this.startTime, this.startTime)
      ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'InvalidClaimWindow');
    });

    it('reverts with {InvalidClaimWindow} if endTime is in the past', async function () {
      const pastTime = this.currentTime - 3600; // 1 hour ago

      await expect(
        this.LimitedOCPointsMerkleClaim.connect(deployer).setMerkleRoot(this.root, this.totalAmount, pastTime - 1800, pastTime)
      ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'InvalidClaimWindow');
    });

    context('when successful', function () {
      it('increments the current epoch ID', async function () {
        const initialEpochId = await this.LimitedOCPointsMerkleClaim.currentEpochId();
        await this.LimitedOCPointsMerkleClaim.connect(deployer).setMerkleRoot(this.root, this.totalAmount, this.startTime, this.endTime);
        expect(await this.LimitedOCPointsMerkleClaim.currentEpochId()).to.be.equal(initialEpochId + 1n);
      });

      it('sets the claim epoch data correctly', async function () {
        await this.LimitedOCPointsMerkleClaim.connect(deployer).setMerkleRoot(this.root, this.totalAmount, this.startTime, this.endTime);
        const epoch = await this.LimitedOCPointsMerkleClaim.claimEpochs(this.epochId);

        expect(epoch.merkleRoot).to.be.equal(this.root);
        expect(epoch.totalAmount).to.be.equal(this.totalAmount);
        expect(epoch.amountLeft).to.be.equal(this.totalAmount);
        expect(epoch.startTime).to.be.equal(this.startTime);
        expect(epoch.endTime).to.be.equal(this.endTime);
      });

      it('emits a {MerkleRootSet} event', async function () {
        await expect(this.LimitedOCPointsMerkleClaim.connect(deployer).setMerkleRoot(this.root, this.totalAmount, this.startTime, this.endTime))
          .to.emit(this.LimitedOCPointsMerkleClaim, 'MerkleRootSet')
          .withArgs(this.epochId, this.root, this.totalAmount, this.startTime, this.endTime);
      });

      it('allows setting multiple epochs', async function () {
        await this.LimitedOCPointsMerkleClaim.connect(deployer).setMerkleRoot(this.root, this.totalAmount, this.startTime, this.endTime);

        const newRoot = ethers.keccak256(ethers.toUtf8Bytes('new root'));
        const newStartTime = this.endTime + 100;
        const newEndTime = newStartTime + 3600;
        const newTotalAmount = 2000n;

        await expect(this.LimitedOCPointsMerkleClaim.connect(deployer).setMerkleRoot(newRoot, newTotalAmount, newStartTime, newEndTime))
          .to.emit(this.LimitedOCPointsMerkleClaim, 'MerkleRootSet')
          .withArgs(1n, newRoot, newTotalAmount, newStartTime, newEndTime);

        expect(await this.LimitedOCPointsMerkleClaim.currentEpochId()).to.be.equal(2n);
      });
    });
  });

  describe('claim(uint256,address,uint256,bytes32,bytes32[])', function () {
    beforeEach(async function () {
      await this.LimitedOCPointsMerkleClaim.connect(deployer).setMerkleRoot(this.root, this.totalAmount, this.startTime, this.endTime);
    });

    it('reverts with {ClaimEpochNotFound} if the epoch does not exist', async function () {
      await helpers.time.increase(100);

      const invalidEpochId = 999n;
      const claimData = this.payouts[0];
      const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));

      await expect(
        this.LimitedOCPointsMerkleClaim.claim(invalidEpochId, claimData.recipient, claimData.amount, claimData.reasonCode, proof)
      ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'ClaimEpochNotFound');
    });

    it('reverts with {ClaimingEpochNotActive} if claiming before start time', async function () {
      const claimData = this.payouts[0];
      const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));

      await expect(
        this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData.recipient, claimData.amount, claimData.reasonCode, proof)
      ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'ClaimingEpochNotActive');
    });

    it('reverts with {ClaimingEpochNotActive} if claiming after end time', async function () {
      await helpers.time.increase(3700); // start + end time = 100 + 3600 = 3700

      const claimData = this.payouts[0];
      const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));

      await helpers.time.increase(100);

      await expect(
        this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData.recipient, claimData.amount, claimData.reasonCode, proof)
      ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'ClaimingEpochNotActive');
    });

    it('reverts with {AlreadyClaimed} if the user has already claimed for this epoch', async function () {
      await helpers.time.increase(100);

      const claimData = this.payouts[0];
      const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));

      await this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData.recipient, claimData.amount, claimData.reasonCode, proof);

      await expect(this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData.recipient, claimData.amount, claimData.reasonCode, proof))
        .to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'AlreadyClaimed')
        .withArgs(claimData.recipient, claimData.amount, claimData.reasonCode, this.epochId);
    });

    it('reverts with {InvalidProof} if the merkle proof verification fails', async function () {
      await helpers.time.increase(100);

      const claimData = this.payouts[0];
      const invalidProof = this.tree.getHexProof(ethers.keccak256(this.leaves[1])); // Wrong proof

      await expect(this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData.recipient, claimData.amount, claimData.reasonCode, invalidProof))
        .to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'InvalidProof')
        .withArgs(claimData.recipient, claimData.amount, claimData.reasonCode, this.epochId);
    });

    context('when successful', function () {
      beforeEach(async function () {
        await helpers.time.increase(100);
      });

      it('calls POINTS_CONTRACT.deposit() with correct arguments', async function () {
        const claimData = this.payouts[0];
        const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));

        await expect(this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData.recipient, claimData.amount, claimData.reasonCode, proof))
          .to.emit(this.PointsContract, 'Deposited')
          .withArgs(await this.LimitedOCPointsMerkleClaim.getAddress(), claimData.reasonCode, claimData.recipient, claimData.amount);
      });

      it('marks the claim as completed', async function () {
        const claimData = this.payouts[0];
        const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));
        const leaf = ethers.keccak256(
          ethers.solidityPacked(
            ['address', 'uint256', 'bytes32', 'uint256'],
            [claimData.recipient, claimData.amount, claimData.reasonCode, claimData.epochId]
          )
        );

        expect(await this.LimitedOCPointsMerkleClaim.claimed(leaf)).to.be.false;
        await this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData.recipient, claimData.amount, claimData.reasonCode, proof);
        expect(await this.LimitedOCPointsMerkleClaim.claimed(leaf)).to.be.true;
      });

      it('reduces the amount left in the pool', async function () {
        const claimData = this.payouts[0];
        const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));

        const epochBefore = await this.LimitedOCPointsMerkleClaim.claimEpochs(this.epochId);
        await this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData.recipient, claimData.amount, claimData.reasonCode, proof);
        const epochAfter = await this.LimitedOCPointsMerkleClaim.claimEpochs(this.epochId);

        expect(epochAfter.amountLeft).to.be.equal(epochBefore.amountLeft - claimData.amount);
      });

      it('emits a {PointsClaimed} event', async function () {
        const claimData = this.payouts[0];
        const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));
        const expectedAmountLeft = this.totalAmount - claimData.amount;

        await expect(this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData.recipient, claimData.amount, claimData.reasonCode, proof))
          .to.emit(this.LimitedOCPointsMerkleClaim, 'PointsClaimed')
          .withArgs(this.epochId, this.root, claimData.recipient, claimData.amount, expectedAmountLeft);
      });

      it('allows multiple users to claim from the same epoch', async function () {
        const claimData1 = this.payouts[0];
        const claimData2 = this.payouts[1];
        const proof1 = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));
        const proof2 = this.tree.getHexProof(ethers.keccak256(this.leaves[1]));

        await this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData1.recipient, claimData1.amount, claimData1.reasonCode, proof1);
        await this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData2.recipient, claimData2.amount, claimData2.reasonCode, proof2);

        const epoch = await this.LimitedOCPointsMerkleClaim.claimEpochs(this.epochId);
        expect(epoch.amountLeft).to.be.equal(this.totalAmount - claimData1.amount - claimData2.amount);
      });

      it('prevents claiming when pool is depleted', async function () {
        const claimData1 = this.payouts[0];
        const claimData2 = this.payouts[1];
        const claimData3 = this.payouts[2];
        const claimData4 = this.payouts[3];

        const proof1 = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));
        const proof2 = this.tree.getHexProof(ethers.keccak256(this.leaves[1]));
        const proof3 = this.tree.getHexProof(ethers.keccak256(this.leaves[2]));
        const proof4 = this.tree.getHexProof(ethers.keccak256(this.leaves[3]));

        await this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData1.recipient, claimData1.amount, claimData1.reasonCode, proof1);
        await this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData2.recipient, claimData2.amount, claimData2.reasonCode, proof2);
        await this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData3.recipient, claimData3.amount, claimData3.reasonCode, proof3);

        await expect(
          this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData4.recipient, claimData4.amount, claimData4.reasonCode, proof4)
        ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'InsufficientPoolAmount');
      });
    });
  });

  describe('canClaim(uint256,address,uint256,bytes32)', function () {
    beforeEach(async function () {
      await this.LimitedOCPointsMerkleClaim.connect(deployer).setMerkleRoot(this.root, this.totalAmount, this.startTime, this.endTime);
    });

    it('returns ClaimEpochNotFound for non-existent epoch', async function () {
      await helpers.time.increase(100);

      const invalidEpochId = 999n;
      const claimData = this.payouts[0];

      expect(await this.LimitedOCPointsMerkleClaim.canClaim(invalidEpochId, claimData.recipient, claimData.amount, claimData.reasonCode)).to.be.equal(
        1n
      );
    });

    it('returns ClaimingEpochNotActive before start time', async function () {
      const claimData = this.payouts[0];

      expect(await this.LimitedOCPointsMerkleClaim.canClaim(this.epochId, claimData.recipient, claimData.amount, claimData.reasonCode)).to.be.equal(
        2n
      );
    });

    it('returns ClaimingEpochNotActive after end time', async function () {
      await helpers.time.increase(3700);

      const claimData = this.payouts[0];

      expect(await this.LimitedOCPointsMerkleClaim.canClaim(this.epochId, claimData.recipient, claimData.amount, claimData.reasonCode)).to.be.equal(
        2n
      );
    });

    it('returns AlreadyClaimed for users who have already claimed', async function () {
      await helpers.time.increase(100);

      const claimData = this.payouts[0];
      const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));

      await this.LimitedOCPointsMerkleClaim.claim(this.epochId, claimData.recipient, claimData.amount, claimData.reasonCode, proof);

      expect(await this.LimitedOCPointsMerkleClaim.canClaim(this.epochId, claimData.recipient, claimData.amount, claimData.reasonCode)).to.be.equal(
        3n
      );
    });

    it('returns InsufficientPoolAmount when pool does not have enough tokens', async function () {
      await helpers.time.increase(100);

      const excessiveAmount = this.totalAmount + 1n;
      const claimData = this.payouts[0];

      expect(await this.LimitedOCPointsMerkleClaim.canClaim(this.epochId, claimData.recipient, excessiveAmount, claimData.reasonCode)).to.be.equal(
        4n
      );
    });

    it('returns NoError for valid claim attempts', async function () {
      await helpers.time.increase(100);

      const claimData = this.payouts[0];

      expect(await this.LimitedOCPointsMerkleClaim.canClaim(this.epochId, claimData.recipient, claimData.amount, claimData.reasonCode)).to.be.equal(
        0n
      );
    });
  });

  describe('Meta transaction', function () {
    it('returns the msg.sender', async function () {
      await this.LimitedOCPointsMerkleClaim.__msgSender();
    });

    it('returns the msg.data', async function () {
      await this.LimitedOCPointsMerkleClaim.__msgData();
    });
  });
});
