const {ethers} = require('hardhat');
const {expect} = require('chai');
const {MerkleTree} = require('merkletreejs');

const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {getForwarderRegistryAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');
const helpers = require('@nomicfoundation/hardhat-network-helpers');

const {setupLimitedOCPointsMerkleClaim} = require('../setup');

describe('LimitedOCPointsMerkleClaim', function () {
  let deployer, owner, admin, distributor, claimer1, claimer2, claimer3, claimer4, other;

  before(async function () {
    [deployer, owner, admin, distributor, claimer1, claimer2, claimer3, claimer4, other] = await ethers.getSigners();
  });

  const fixture = async function () {
    this.initialAllocation = 900n;
    await setupLimitedOCPointsMerkleClaim.call(this, admin);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);

    this.currentTime = await helpers.time.latest();
    this.startTime = this.currentTime + 100; // starts in 100 seconds
    this.endTime = this.startTime + 3600; // lasts for 1 hour
    this.reasonCode = ethers.keccak256(ethers.solidityPacked(['string', 'address'], ['LIMITED_POINTS_CLAIM_', distributor.address]));
    this.initialNonce = (await this.LimitedOCPointsMerkleClaim.epochs(distributor.address)).nonce;
    this.expectedNonce = this.initialNonce + 1n;

    this.payouts = [
      {
        recipient: claimer1.address,
        amount: 100n,
      },
      {
        recipient: claimer2.address,
        amount: 200n,
      },
      {
        recipient: claimer3.address,
        amount: 300n,
      },
      {
        recipient: claimer4.address,
        amount: 400n,
      },
    ];

    this.leaves = this.payouts.map(({recipient, amount}) => {
      return ethers.solidityPacked(['uint256', 'address', 'uint256', 'bytes32'], [this.expectedNonce, recipient, amount, this.reasonCode]);
    });
    this.tree = new MerkleTree(this.leaves, ethers.keccak256, {hashLeaves: true, sortPairs: true});
    this.root = this.tree.getHexRoot();
  });

  describe('constructor', function () {
    it('reverts with {InvalidPointsContractAddress} if the points contract address is the zero address', async function () {
      await expect(
        deployContract('LimitedOCPointsMerkleClaim', ethers.ZeroAddress, await getForwarderRegistryAddress())
      ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'InvalidPointsContractAddress');
    });

    context('when successful', function () {
      it('sets the forwarder registry address', async function () {
        expect(await this.LimitedOCPointsMerkleClaim.forwarderRegistry()).to.be.equal(await getForwarderRegistryAddress());
      });

      it('sets the points contract address', async function () {
        expect(await this.LimitedOCPointsMerkleClaim.POINTS_CONTRACT()).to.be.equal(await this.PointsContract.getAddress());
      });

      it('initializes with no allocations', async function () {
        expect(await this.LimitedOCPointsMerkleClaim.allocations(distributor.address)).to.be.equal(0n);
        expect(await this.LimitedOCPointsMerkleClaim.consumed(distributor.address)).to.be.equal(0n);
      });

      it('initializes epoch nonce to 0', async function () {
        const epochData = await this.LimitedOCPointsMerkleClaim.epochs(distributor.address);
        expect(epochData.nonce).to.be.equal(0);
      });
    });
  });

  describe('setMerkleRoot(bytes32,uint256,uint256)', function () {
    it('reverts with {NoAllocation} if distributor has no allocation', async function () {
      await expect(
        this.LimitedOCPointsMerkleClaim.connect(other).setMerkleRoot(this.root, this.startTime, this.endTime)
      ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'NoAllocation');
    });

    context('when distributor has allocation', function () {
      beforeEach(async function () {
        await this.LimitedOCPointsMerkleClaim.connect(admin).increaseAllocation(distributor.address, this.initialAllocation);
      });

      it('reverts with {InvalidClaimWindow} if endTime is before startTime', async function () {
        await expect(
          this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(this.root, this.endTime, this.startTime)
        ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'InvalidClaimWindow');
      });

      it('reverts with {InvalidClaimWindow} if startTime equals endTime', async function () {
        await expect(
          this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(this.root, this.startTime, this.startTime)
        ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'InvalidClaimWindow');
      });

      it('reverts with {InvalidClaimWindow} if endTime is in the past', async function () {
        const pastTime = this.currentTime - 3600; // 1 hour ago

        await expect(
          this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(this.root, pastTime - 1800, pastTime)
        ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'InvalidClaimWindow');
      });

      it('reverts with {MerkleRootCannotBeZero} if the merkle root is zero', async function () {
        await expect(
          this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(ethers.ZeroHash, this.startTime, this.endTime)
        ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'MerkleRootCannotBeZero');
      });

      context('when successful', function () {
        it('sets the merkle root and time window correctly', async function () {
          await this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(this.root, this.startTime, this.endTime);

          const epochData = await this.LimitedOCPointsMerkleClaim.epochs(distributor.address);
          expect(epochData.root).to.be.equal(this.root);
          expect(epochData.startTime).to.be.equal(this.startTime);
          expect(epochData.endTime).to.be.equal(this.endTime);
        });

        it('increments the nonce', async function () {
          await this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(this.root, this.startTime, this.endTime);
          const epochData = await this.LimitedOCPointsMerkleClaim.epochs(distributor.address);

          expect(epochData.nonce).to.be.equal(this.expectedNonce);
        });

        it('emits a {MerkleRootSet} event', async function () {
          const allocation = await this.LimitedOCPointsMerkleClaim.allocations(distributor.address);
          const consumed = await this.LimitedOCPointsMerkleClaim.consumed(distributor.address);
          const amountClaimable = allocation - consumed;

          await expect(this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(this.root, this.startTime, this.endTime))
            .to.emit(this.LimitedOCPointsMerkleClaim, 'MerkleRootSet')
            .withArgs(distributor.address, this.root, this.expectedNonce, amountClaimable, this.startTime, this.endTime);
        });
      });
    });
  });

  describe('claim(address,address,uint256,bytes32[])', function () {
    beforeEach(async function () {
      await this.LimitedOCPointsMerkleClaim.connect(admin).increaseAllocation(distributor.address, this.initialAllocation);
    });

    it('reverts with {MerkleRootNotSet} if no merkle root is set', async function () {
      const claimData = this.payouts[0];
      const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));

      await expect(
        this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData.recipient, claimData.amount, proof)
      ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'MerkleRootNotSet');
    });

    it('reverts with {ClaimNotActive} if claiming before start time', async function () {
      await this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(this.root, this.startTime, this.endTime);

      const claimData = this.payouts[0];
      const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));

      await expect(
        this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData.recipient, claimData.amount, proof)
      ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'ClaimNotActive');
    });

    it('reverts with {ClaimNotActive} if claiming after end time', async function () {
      await this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(this.root, this.startTime, this.endTime);

      await helpers.time.increase(3700); // start + end time = 100 + 3600 = 3700

      const claimData = this.payouts[0];
      const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));

      await expect(
        this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData.recipient, claimData.amount, proof)
      ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'ClaimNotActive');
    });

    it('reverts with {InsufficientAllocation} if the allocation does not have enough tokens', async function () {
      const claimData = this.payouts[0];
      const allocation = await this.LimitedOCPointsMerkleClaim.allocations(distributor.address);
      const consumed = await this.LimitedOCPointsMerkleClaim.consumed(distributor.address);
      const excessiveAmount = allocation - consumed + 1n;

      // Create a leaf for the excessive amount
      const excessiveLeaf = ethers.solidityPacked(
        ['uint256', 'address', 'uint256', 'bytes32'],
        [this.expectedNonce, claimData.recipient, excessiveAmount, this.reasonCode]
      );
      const singleLeafTree = new MerkleTree([excessiveLeaf], ethers.keccak256, {hashLeaves: true, sortPairs: true});
      const excessiveRoot = singleLeafTree.getHexRoot();

      // Set new merkle root with excessive amount
      await this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(excessiveRoot, this.startTime, this.endTime);
      await helpers.time.increase(100);

      const proof = singleLeafTree.getHexProof(ethers.keccak256(excessiveLeaf));

      await expect(
        this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData.recipient, excessiveAmount, proof)
      ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'InsufficientAllocation');
    });

    it('reverts with {AlreadyClaimed} if the user has already claimed', async function () {
      await this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(this.root, this.startTime, this.endTime);
      await helpers.time.increase(100);

      const claimData = this.payouts[0];
      const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));

      await this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData.recipient, claimData.amount, proof);

      await expect(this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData.recipient, claimData.amount, proof))
        .to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'AlreadyClaimed')
        .withArgs(distributor.address, this.expectedNonce, claimData.recipient, claimData.amount, this.reasonCode);
    });

    it('reverts with {InvalidProof} if the merkle proof verification fails', async function () {
      await this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(this.root, this.startTime, this.endTime);
      await helpers.time.increase(100);

      const claimData = this.payouts[0];
      const invalidProof = this.tree.getHexProof(ethers.keccak256(this.leaves[1])); // Wrong proof

      await expect(this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData.recipient, claimData.amount, invalidProof))
        .to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'InvalidProof')
        .withArgs(distributor.address, this.expectedNonce, claimData.recipient, claimData.amount, this.reasonCode);
    });

    context('when successful', function () {
      beforeEach(async function () {
        await this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(this.root, this.startTime, this.endTime);
        await helpers.time.increase(100);
      });

      it('calls POINTS_CONTRACT.deposit() with correct arguments', async function () {
        const claimData = this.payouts[0];
        const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));

        await expect(this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData.recipient, claimData.amount, proof))
          .to.emit(this.PointsContract, 'Deposited')
          .withArgs(await this.LimitedOCPointsMerkleClaim.getAddress(), this.reasonCode, claimData.recipient, claimData.amount);
      });

      it('marks the claim as completed', async function () {
        const claimData = this.payouts[0];
        const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));
        const leafHash = ethers.keccak256(this.leaves[0]);

        expect(await this.LimitedOCPointsMerkleClaim.claimed(leafHash)).to.be.false;
        await this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData.recipient, claimData.amount, proof);
        expect(await this.LimitedOCPointsMerkleClaim.claimed(leafHash)).to.be.true;
      });

      it('increases the amount consumed for the distributor', async function () {
        const claimData = this.payouts[0];
        const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));

        const consumedBefore = await this.LimitedOCPointsMerkleClaim.consumed(distributor.address);
        await this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData.recipient, claimData.amount, proof);
        const consumedAfter = await this.LimitedOCPointsMerkleClaim.consumed(distributor.address);

        expect(consumedAfter).to.be.equal(consumedBefore + claimData.amount);
      });

      it('emits a {PointsClaimed} event', async function () {
        const claimData = this.payouts[0];
        const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));
        const allocation = await this.LimitedOCPointsMerkleClaim.allocations(distributor.address);
        const consumed = await this.LimitedOCPointsMerkleClaim.consumed(distributor.address);
        const amountLeft = allocation - consumed;
        const expectedAmountLeft = amountLeft - claimData.amount;

        await expect(this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData.recipient, claimData.amount, proof))
          .to.emit(this.LimitedOCPointsMerkleClaim, 'PointsClaimed')
          .withArgs(distributor.address, this.root, claimData.recipient, this.expectedNonce, claimData.amount, expectedAmountLeft);
      });

      it('allows multiple users to claim from the allocation', async function () {
        const claimData1 = this.payouts[0];
        const claimData2 = this.payouts[1];
        const proof1 = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));
        const proof2 = this.tree.getHexProof(ethers.keccak256(this.leaves[1]));

        const initialConsumed = await this.LimitedOCPointsMerkleClaim.consumed(distributor.address);

        await this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData1.recipient, claimData1.amount, proof1);
        await this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData2.recipient, claimData2.amount, proof2);

        const finalConsumed = await this.LimitedOCPointsMerkleClaim.consumed(distributor.address);
        expect(finalConsumed).to.be.equal(initialConsumed + claimData1.amount + claimData2.amount);
      });

      it('prevents claiming when allocation is depleted', async function () {
        const claimData1 = this.payouts[0];
        const claimData2 = this.payouts[1];
        const claimData3 = this.payouts[2];
        const claimData4 = this.payouts[3];

        const proof1 = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));
        const proof2 = this.tree.getHexProof(ethers.keccak256(this.leaves[1]));
        const proof3 = this.tree.getHexProof(ethers.keccak256(this.leaves[2]));
        const proof4 = this.tree.getHexProof(ethers.keccak256(this.leaves[3]));

        await this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData1.recipient, claimData1.amount, proof1);
        await this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData2.recipient, claimData2.amount, proof2);
        await this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData3.recipient, claimData3.amount, proof3);

        await expect(
          this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData4.recipient, claimData4.amount, proof4)
        ).to.be.revertedWithCustomError(this.LimitedOCPointsMerkleClaim, 'InsufficientAllocation');
      });
    });
  });

  describe('canClaim(address,address,uint256)', function () {
    beforeEach(async function () {
      await this.LimitedOCPointsMerkleClaim.connect(admin).increaseAllocation(distributor.address, this.initialAllocation);
    });

    it('returns MerkleRootNotSet for distributors without merkle root', async function () {
      const claimData = this.payouts[0];

      expect(await this.LimitedOCPointsMerkleClaim.canClaim(distributor.address, claimData.recipient, claimData.amount)).to.be.equal(1n);
    });

    it('returns ClaimNotActive before start time', async function () {
      await this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(this.root, this.startTime, this.endTime);
      const claimData = this.payouts[0];

      expect(await this.LimitedOCPointsMerkleClaim.canClaim(distributor.address, claimData.recipient, claimData.amount)).to.be.equal(2n);
    });

    it('returns ClaimNotActive after end time', async function () {
      await this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(this.root, this.startTime, this.endTime);
      await helpers.time.increase(3700);

      const claimData = this.payouts[0];

      expect(await this.LimitedOCPointsMerkleClaim.canClaim(distributor.address, claimData.recipient, claimData.amount)).to.be.equal(2n);
    });

    it('returns InsufficientAllocation when distributor does not have enough allocation', async function () {
      const claimData = this.payouts[0];
      const allocation = await this.LimitedOCPointsMerkleClaim.allocations(distributor.address);
      const consumed = await this.LimitedOCPointsMerkleClaim.consumed(distributor.address);
      const excessiveAmount = allocation - consumed + 1n;

      // Create a leaf for the excessive amount
      const excessiveLeaf = ethers.solidityPacked(
        ['uint256', 'address', 'uint256', 'bytes32'],
        [this.expectedNonce, claimData.recipient, excessiveAmount, this.reasonCode]
      );
      const singleLeafTree = new MerkleTree([excessiveLeaf], ethers.keccak256, {hashLeaves: true, sortPairs: true});
      const excessiveRoot = singleLeafTree.getHexRoot();

      // Set new merkle root with excessive amount
      await this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(excessiveRoot, this.startTime, this.endTime);
      await helpers.time.increase(100);

      expect(await this.LimitedOCPointsMerkleClaim.canClaim(distributor.address, claimData.recipient, excessiveAmount)).to.be.equal(5n);
    });

    it('returns AlreadyClaimed for users who have already claimed', async function () {
      await this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(this.root, this.startTime, this.endTime);
      await helpers.time.increase(100);

      const claimData = this.payouts[0];
      const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));

      await this.LimitedOCPointsMerkleClaim.claim(distributor.address, claimData.recipient, claimData.amount, proof);

      expect(await this.LimitedOCPointsMerkleClaim.canClaim(distributor.address, claimData.recipient, claimData.amount)).to.be.equal(3n);
    });

    it('returns NoError for valid claim attempts', async function () {
      await this.LimitedOCPointsMerkleClaim.connect(distributor).setMerkleRoot(this.root, this.startTime, this.endTime);
      await helpers.time.increase(100);

      const claimData = this.payouts[0];

      expect(await this.LimitedOCPointsMerkleClaim.canClaim(distributor.address, claimData.recipient, claimData.amount)).to.be.equal(0n);
    });
  });

  describe('increaseAllocation(address,uint256)', function () {
    it('reverts with {NotRoleHolder} if not called by an admin', async function () {
      await expect(this.LimitedOCPointsMerkleClaim.connect(distributor).increaseAllocation(distributor.address, 2000n)).to.be.revertedWithCustomError(
        this.LimitedOCPointsMerkleClaim,
        'NotRoleHolder'
      );
    });

    it('reverts with {InvalidAllocationSize} if increment amount is zero', async function () {
      await expect(this.LimitedOCPointsMerkleClaim.connect(admin).increaseAllocation(distributor.address, 0)).to.be.revertedWithCustomError(
        this.LimitedOCPointsMerkleClaim,
        'InvalidAllocationSize'
      );
    });

    context('when successful', function () {
      it('increases the allocation size by the specified amount', async function () {
        const oldAllocation = await this.LimitedOCPointsMerkleClaim.allocations(distributor.address);
        const increment = 2000n;
        const expectedNewAllocation = oldAllocation + increment;

        await this.LimitedOCPointsMerkleClaim.connect(admin).increaseAllocation(distributor.address, increment);

        expect(await this.LimitedOCPointsMerkleClaim.allocations(distributor.address)).to.be.equal(expectedNewAllocation);
      });

      it('emits a {AllocationUpdated} event', async function () {
        const oldAllocation = await this.LimitedOCPointsMerkleClaim.allocations(distributor.address);
        const increment = 2000n;
        const expectedNewAllocation = oldAllocation + increment;

        await expect(this.LimitedOCPointsMerkleClaim.connect(admin).increaseAllocation(distributor.address, increment))
          .to.emit(this.LimitedOCPointsMerkleClaim, 'AllocationUpdated')
          .withArgs(distributor.address, oldAllocation, expectedNewAllocation);
      });
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
