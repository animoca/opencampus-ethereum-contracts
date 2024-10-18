const {ethers} = require('hardhat');
const {expect} = require('chai');
const {MerkleTree} = require('merkletreejs');

const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {getForwarderRegistryAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');

const {setupOCPointMerkleClaimMock} = require('../setup');

describe('OCPointMerkleClaim', function () {
  let deployer, operator, claimer1, claimer2, claimer3, claimer4, other;

  before(async function () {
    [deployer, operator, claimer1, claimer2, claimer3, claimer4, other] = await ethers.getSigners();
  });

  const fixture = async function () {
    await setupOCPointMerkleClaimMock.call(this, deployer, operator);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);

    this.nextTreeCounter = (await this.OCPointMerkleClaim.treeCounter()) + 1n;
    this.payouts = [
      {
        claimer: claimer1.address,
        amounts: [1n],
        depositReasonCodes: [ethers.encodeBytes32String('OC_POINTS_MIGRATION')],
      },
      {
        claimer: claimer2.address,
        amounts: [1n, 2n],
        depositReasonCodes: [ethers.encodeBytes32String('SEASON1_DAPP1'), ethers.encodeBytes32String('SEASON1_DAPP2')],
      },
      {
        // inconsistent amounts and depositReasonCodes
        claimer: claimer3.address,
        amounts: [2n],
        depositReasonCodes: [ethers.encodeBytes32String('SEASON1_DAPP1'), ethers.encodeBytes32String('SEASON1_DAPP2')],
      },
    ];
    this.leaves = this.payouts.map(({claimer, amounts, depositReasonCodes}) => {
      return ethers.solidityPacked(['address', 'uint256[]', 'bytes32[]', 'uint256'], [claimer, amounts, depositReasonCodes, this.nextTreeCounter]);
    });
    this.tree = new MerkleTree(this.leaves, ethers.keccak256, {hashLeaves: true, sortPairs: true});
    this.root = this.tree.getHexRoot();
  });

  describe('constructor', function () {
    it('reverts with {InvalidOCPointContractAddress} if the OCPoint contract address is the zero address', async function () {
      await expect(deployContract('OCPointMerkleClaimMock', ethers.ZeroAddress, await getForwarderRegistryAddress())).to.revertedWithCustomError(
        this.OCPointMerkleClaim,
        'InvalidOCPointContractAddress'
      );
    });

    context('when successful', function () {
      it('sets the forwarder registry address', async function () {
        expect(await this.OCPointMerkleClaim.forwarderRegistry()).to.be.equal(await getForwarderRegistryAddress());
      });

      it('sets the OCPoint address', async function () {
        expect(await this.OCPointMerkleClaim.OCPoint()).to.be.equal(await this.OCPoint.getAddress());
      });

      it('contract is paused', async function () {
        expect(await this.OCPointMerkleClaim.paused()).to.be.true;
      });
    });
  });

  describe('claimPayout(address,uint256,bytes32[],bytes32[])', function () {
    beforeEach(async function () {
      await this.OCPointMerkleClaim.connect(operator).setMerkleRoot(this.root);
    });

    it('reverts with {Paused} if the contract is paused', async function () {
      await this.OCPointMerkleClaim.connect(operator).pause();

      const claimData = this.payouts[0];
      await expect(
        this.OCPointMerkleClaim.claimPayout(
          claimData.claimer,
          claimData.amounts,
          claimData.depositReasonCodes,
          this.tree.getHexProof(ethers.keccak256(this.leaves[0]))
        )
      ).to.be.revertedWithCustomError(this.OCPointMerkleClaim, 'Paused');
    });

    it('reverts with {InconsistentArrayLengths} for inconsistent amounts and depositReasonCodes length', async function () {
      const claimData = this.payouts[2];
      await expect(
        this.OCPointMerkleClaim.claimPayout(
          claimData.claimer,
          claimData.amounts,
          claimData.depositReasonCodes,
          this.tree.getHexProof(ethers.keccak256(this.leaves[2]))
        )
      ).to.be.revertedWithCustomError(this.OCPointMerkleClaim, 'InconsistentArrayLengths');
    });

    it('reverts with {AlreadyClaimed} if this specific payout has already been claimed', async function () {
      const claimData = this.payouts[0];
      const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));
      await this.OCPointMerkleClaim.claimPayout(claimData.claimer, claimData.amounts, claimData.depositReasonCodes, proof);

      await expect(this.OCPointMerkleClaim.claimPayout(claimData.claimer, claimData.amounts, claimData.depositReasonCodes, proof))
        .to.be.revertedWithCustomError(this.OCPointMerkleClaim, 'AlreadyClaimed')
        .withArgs(claimData.claimer, claimData.amounts, claimData.depositReasonCodes, this.nextTreeCounter);
    });

    it('reverts with {InvalidProof} if the merkle proof has failed the verification', async function () {
      const claimData = this.payouts[0];
      const invalidProof = this.tree.getHexProof(ethers.keccak256(this.leaves[1]));

      await expect(this.OCPointMerkleClaim.claimPayout(claimData.claimer, claimData.amounts, claimData.depositReasonCodes, invalidProof))
        .to.be.revertedWithCustomError(this.OCPointMerkleClaim, 'InvalidProof')
        .withArgs(claimData.claimer, claimData.amounts, claimData.depositReasonCodes, this.nextTreeCounter);
    });

    context('when successful (single payout)', function () {
      it('calls OCPoint.deposit(address,uint256,bytes32) with correct arguments', async function () {
        const claimData = this.payouts[0];
        const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));
        await expect(this.OCPointMerkleClaim.claimPayout(claimData.claimer, claimData.amounts, claimData.depositReasonCodes, proof))
          .to.emit(this.OCPoint, 'Deposited')
          .withArgs(await this.OCPointMerkleClaim.getAddress(), claimData.depositReasonCodes[0], claimData.claimer, claimData.amounts[0]);
      });

      it('emits a {PayoutClaimed} event', async function () {
        const claimData = this.payouts[0];
        const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[0]));
        await expect(this.OCPointMerkleClaim.claimPayout(claimData.claimer, claimData.amounts, claimData.depositReasonCodes, proof))
          .to.emit(this.OCPointMerkleClaim, 'PayoutClaimed')
          .withArgs(this.root, claimData.claimer, claimData.amounts, claimData.depositReasonCodes, this.nextTreeCounter);
      });
    });

    context('when successful (multiple payouts)', function () {
      it('calls OCPoint.deposit(address,uint256,bytes32) with correct arguments', async function () {
        const claimData = this.payouts[1];
        const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[1]));
        await expect(this.OCPointMerkleClaim.claimPayout(claimData.claimer, claimData.amounts, claimData.depositReasonCodes, proof))
          .to.emit(this.OCPoint, 'Deposited')
          .withArgs(await this.OCPointMerkleClaim.getAddress(), claimData.depositReasonCodes[0], claimData.claimer, claimData.amounts[0])
          .and.to.emit(this.OCPoint, 'Deposited')
          .withArgs(await this.OCPointMerkleClaim.getAddress(), claimData.depositReasonCodes[1], claimData.claimer, claimData.amounts[1]);
      });

      it('emits a {PayoutClaimed} event', async function () {
        const claimData = this.payouts[1];
        const proof = this.tree.getHexProof(ethers.keccak256(this.leaves[1]));
        await expect(this.OCPointMerkleClaim.claimPayout(claimData.claimer, claimData.amounts, claimData.depositReasonCodes, proof))
          .to.emit(this.OCPointMerkleClaim, 'PayoutClaimed')
          .withArgs(this.root, claimData.claimer, claimData.amounts, claimData.depositReasonCodes, this.nextTreeCounter);
      });
    });
  });

  describe('pause()', function () {
    it('reverts with {NotRoleHolder} error if not called by the operator', async function () {
      await expect(this.OCPointMerkleClaim.connect(deployer).pause())
        .to.be.revertedWithCustomError(this.OCPointMerkleClaim, 'NotRoleHolder')
        .withArgs(this.OCPointMerkleClaim.OPERATOR_ROLE(), deployer.address);
    });

    it('reverts with {Paused} error if the contract is paused', async function () {
      await expect(this.OCPointMerkleClaim.connect(operator).pause()).to.be.revertedWithCustomError(this.OCPointMerkleClaim, 'Paused');
    });

    context('when successful', function () {
      it('pauses the contract and emits a {Pause} event', async function () {
        await this.OCPointMerkleClaim.connect(operator).unpause(); // the OCPointMerkleClaim contract is paused when constructed

        await expect(this.OCPointMerkleClaim.connect(operator).pause()).to.emit(this.OCPointMerkleClaim, 'Pause');
        expect(await this.OCPointMerkleClaim.paused()).to.be.true;
      });
    });
  });

  describe('unpause()', function () {
    it('reverts with {NotRoleHolder} error if not called by the operator', async function () {
      await expect(this.OCPointMerkleClaim.connect(deployer).unpause())
        .to.be.revertedWithCustomError(this.OCPointMerkleClaim, 'NotRoleHolder')
        .withArgs(this.OCPointMerkleClaim.OPERATOR_ROLE(), deployer.address);
    });

    it('reverts with {NotPaused} error if the contract is not paused', async function () {
      await this.OCPointMerkleClaim.connect(operator).unpause(); // the OCPointMerkleClaim contract is paused when constructed

      await expect(this.OCPointMerkleClaim.connect(operator).unpause()).to.be.revertedWithCustomError(this.OCPointMerkleClaim, 'NotPaused');
    });

    context('when successful', function () {
      it('unpauses the contract and emits a {Unpause} event', async function () {
        await expect(this.OCPointMerkleClaim.connect(operator).unpause()).to.emit(this.OCPointMerkleClaim, 'Unpause');
        expect(await this.OCPointMerkleClaim.paused()).to.be.false;
      });
    });
  });

  describe('setMerkleRoot(bytes32)', function () {
    it('reverts with {NotRoleHolder} error if not called by the operator', async function () {
      await expect(this.OCPointMerkleClaim.connect(deployer).setMerkleRoot(ethers.ZeroHash))
        .to.be.revertedWithCustomError(this.OCPointMerkleClaim, 'NotRoleHolder')
        .withArgs(this.OCPointMerkleClaim.OPERATOR_ROLE(), deployer.address);
    });

    it('reverts with {NotPaused} error if the contract is not paused', async function () {
      await this.OCPointMerkleClaim.connect(operator).unpause();
      await expect(this.OCPointMerkleClaim.connect(operator).setMerkleRoot(ethers.ZeroHash)).to.be.revertedWithCustomError(
        this.OCPointMerkleClaim,
        'NotPaused'
      );
    });

    context('when successful', function () {
      it('increments the treeCounter', async function () {
        const treeCounter = await this.OCPointMerkleClaim.treeCounter();
        await this.OCPointMerkleClaim.connect(operator).setMerkleRoot(ethers.ZeroHash);
        expect(await this.OCPointMerkleClaim.treeCounter()).to.be.equal(treeCounter + 1n);
      });

      it('unpauses the contract and emits a {Unpause} event', async function () {
        await expect(this.OCPointMerkleClaim.connect(operator).setMerkleRoot(ethers.ZeroHash)).to.emit(this.OCPointMerkleClaim, 'Unpause');
        expect(await this.OCPointMerkleClaim.paused()).to.be.false;
      });

      it('sets the merkle root and emits a {MerkleRootSet} event', async function () {
        await expect(this.OCPointMerkleClaim.connect(operator).setMerkleRoot(this.root))
          .to.emit(this.OCPointMerkleClaim, 'MerkleRootSet')
          .withArgs(this.root);
        expect(await this.OCPointMerkleClaim.root()).to.be.equal(this.root);
      });
    });
  });

  describe('Meta transaction', function () {
    it('returns the msg.sender', async function () {
      await this.OCPointMerkleClaim.__msgSender();
    });

    it('returns the msg.data', async function () {
      await this.OCPointMerkleClaim.__msgData();
    });
  });
});
