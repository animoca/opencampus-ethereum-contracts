const {ethers} = require('hardhat');
const {expect} = require('chai');
const {MerkleTree} = require('merkletreejs');
const keccak256 = require('keccak256');
const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {getForwarderRegistryAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');

describe('EDuCoinMerkleClaim', function () {
  before(async function () {
    [deployer, messageSigner1, messageSigner2, claimer1, claimer2, claimer3, claimer4, other] = await ethers.getSigners();
  });

  const fixture = async function () {
    const forwarderRegistryAddress = await getForwarderRegistryAddress();
    this.erc20 = await deployContract('EDuCoin', 'EDU', 'EDU', 18, [deployer], [ethers.MaxInt256], forwarderRegistryAddress);
    this.contract = await deployContract('EDuCoinMerkleClaimMock', this.erc20.target, messageSigner1, forwarderRegistryAddress);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);

    this.nextTreeCounter = (await this.contract.treeCounter()) + 1n;

    this.elements = [
      {
        claimer: claimer1.address,
        amount: 1n,
      },
      {
        claimer: claimer2.address,
        amount: 2n,
      },
      {
        claimer: claimer3.address,
        amount: 3n,
      },
      {
        claimer: claimer4.address,
        amount: 4n,
      },
    ];
    this.leaves = this.elements.map((el) => ethers.solidityPacked(['address', 'uint256', 'uint256'], [el.claimer, el.amount, this.nextTreeCounter]));
    const sum = this.elements.reduce((acc, el) => acc + el.amount, 0n);
    this.erc20.approve(this.contract.target, sum);
    this.tree = new MerkleTree(this.leaves, keccak256, {hashLeaves: true, sortPairs: true});
    this.root = this.tree.getHexRoot();
  });

  context('claimPayout(address,uint256,bytes32[])', function () {
    beforeEach(async function () {
      await this.contract.setMerkleRoot(this.root);
    });

    it('successfully claim the EDU', async function () {
      const expireAt = Math.floor(Date.now() / 1000) + 1000000;
      const signature = await messageSigner1.signMessage(
        ethers.getBytes(keccak256(ethers.solidityPacked(['address', 'address', 'uint256'], [this.contract.target, claimer1.address, expireAt])))
      );
      await expect(
        this.contract.claimPayout(
          this.elements[0].claimer,
          this.elements[0].amount,
          this.tree.getHexProof(keccak256(this.leaves[0])),
          signature,
          expireAt
        )
      )
        .to.emit(this.erc20, 'Transfer')
        .withArgs(deployer.address, this.elements[0].claimer, this.elements[0].amount)
        .to.emit(this.contract, 'PayoutClaimed')
        .withArgs(this.root, this.elements[0].claimer, this.elements[0].amount, this.nextTreeCounter);
    });

    it('use a claimed leaf to claim again', async function () {
      const expireAt = Math.floor(Date.now() / 1000) + 1000000;
      const signature = await messageSigner1.signMessage(
        ethers.getBytes(keccak256(ethers.solidityPacked(['address', 'address', 'uint256'], [this.contract.target, claimer4.address, expireAt])))
      );
      await expect(
        this.contract.claimPayout(
          this.elements[3].claimer,
          this.elements[3].amount,
          this.tree.getHexProof(keccak256(this.leaves[3])),
          signature,
          expireAt
        )
      );
      await expect(
        this.contract.claimPayout(
          this.elements[3].claimer,
          this.elements[3].amount,
          this.tree.getHexProof(keccak256(this.leaves[3])),
          signature,
          expireAt
        )
      ).to.be.revertedWithCustomError(this.contract, 'AlreadyClaimed');
    });

    it('claim the EDU with expired signature', async function () {
      const expireAt = Math.floor(Date.now() / 1000) - 1000;
      const signature = await messageSigner1.signMessage(
        ethers.getBytes(keccak256(ethers.solidityPacked(['address', 'address', 'uint256'], [this.contract.target, claimer2.address, expireAt])))
      );
      await expect(
        this.contract.claimPayout(
          this.elements[1].claimer,
          this.elements[1].amount,
          this.tree.getHexProof(keccak256(this.leaves[1])),
          signature,
          expireAt
        )
      ).to.be.revertedWithCustomError(this.contract, 'ExpiredSignature');
    });

    it('claim the EDU with invalid signature(signed by non message signer)', async function () {
      const expireAt = Math.floor(Date.now() / 1000) + 1000000;
      const signature = await claimer3.signMessage(
        ethers.getBytes(keccak256(ethers.solidityPacked(['address', 'address', 'uint256'], [this.contract.target, claimer2.address, expireAt])))
      );
      await expect(
        this.contract.claimPayout(
          this.elements[1].claimer,
          this.elements[1].amount,
          this.tree.getHexProof(keccak256(this.leaves[1])),
          signature,
          expireAt
        )
      ).to.be.revertedWithCustomError(this.contract, 'InvalidSignature');
    });

    it('claim the EDU with invalid proof', async function () {
      const expireAt = Math.floor(Date.now() / 1000) + 1000000;
      const signature = await messageSigner1.signMessage(
        ethers.getBytes(keccak256(ethers.solidityPacked(['address', 'address', 'uint256'], [this.contract.target, claimer2.address, expireAt])))
      );
      await expect(
        this.contract.claimPayout(
          this.elements[1].claimer,
          this.elements[0].amount,
          this.tree.getHexProof(keccak256(this.leaves[1])),
          signature,
          expireAt
        )
      ).to.be.revertedWithCustomError(this.contract, 'InvalidProof');
    });
  });

  context('setMerkleRoot(bytes32)', function () {
    it('can successfully set Merkle root and emit event', async function () {
      await expect(this.contract.setMerkleRoot(this.root)).to.emit(this.contract, 'MerkleRootSet').withArgs(this.root);
      expect(await this.contract.root()).to.equal(this.root);
    });

    it('revert if it is not the owner', async function () {
      await expect(this.contract.connect(claimer1).setMerkleRoot(this.root)).to.be.revertedWithCustomError(this.contract, 'NotContractOwner');
    });
  });

  context('setMessageSigner(address)', function () {
    it('can emit the MessageSignerSet event', async function () {
      await expect(this.contract.setMessageSigner(messageSigner2)).to.emit(this.contract, 'MessageSignerSet').withArgs(messageSigner2.address);
    });

    it('revert if it is not the owner', async function () {
      await expect(this.contract.connect(messageSigner2).setMessageSigner(messageSigner2)).to.be.revertedWithCustomError(
        this.contract,
        'NotContractOwner'
      );
    });
  });

  context('Meta transaction', function () {
    it('returns the msg.data', async function () {
      await this.contract.__msgData();
    });
  });
});
