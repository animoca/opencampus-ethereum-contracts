const {ethers} = require('hardhat');
const {expect} = require('chai');
const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {getForwarderRegistryAddress, getTokenMetadataResolverPerTokenAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');

describe('GenesisTokenEscrow', function () {
  before(async function () {
    [deployer, wallet1] = await ethers.getSigners();
  });

  const fixture = async function () {
    this.metadataResolverAddress = await getTokenMetadataResolverPerTokenAddress();
    this.forwarderRegistryAddress = await getForwarderRegistryAddress();

    this.erc721 = await deployContract('ERC721Full', '', '', this.metadataResolverAddress, ethers.ZeroAddress, this.forwarderRegistryAddress);
    await this.erc721.grantRole(await this.erc721.MINTER_ROLE(), deployer.address);
    this.erc721Address = await this.erc721.getAddress();
    this.escrow721 = await deployContract('PublisherNFTEscrowMock', [this.erc721Address], this.forwarderRegistryAddress);
    this.erc721EscrowAddress = await this.escrow721.getAddress();

    this.erc721Alt = await deployContract('ERC721Full', '', '', this.metadataResolverAddress, ethers.ZeroAddress, this.forwarderRegistryAddress);
    await this.erc721Alt.grantRole(await this.erc721Alt.MINTER_ROLE(), deployer.address);
    this.erc721AddressAlt = await this.erc721Alt.getAddress();

    this.erc1155 = await deployContract('ERC1155Full', '', '', this.metadataResolverAddress, ethers.ZeroAddress, this.forwarderRegistryAddress);
    await this.erc1155.grantRole(await this.erc1155.MINTER_ROLE(), deployer.address);
    this.erc1155Address = await this.erc1155.getAddress();
    this.escrow1155 = await deployContract('GenesisTokenEscrowMock', this.erc1155Address, this.forwarderRegistryAddress);
    this.erc1155EscrowAddress = await this.escrow1155.getAddress();
    await this.erc1155.safeBatchMint(deployer.address, [0n, 1n, 2n, 3n], [10n, 10n, 10n, 10n], '0x');

    this.erc1155Unsupported = await deployContract(
      'ERC1155Full',
      '',
      '',
      this.metadataResolverAddress,
      ethers.ZeroAddress,
      this.forwarderRegistryAddress
    );
    await this.erc1155Unsupported.grantRole(await this.erc1155Unsupported.MINTER_ROLE(), deployer.address);
    this.erc1155UnsupportedAddress = await this.erc1155Unsupported.getAddress();
    await this.erc1155Unsupported.safeBatchMint(deployer.address, [0n, 1n, 2n, 3n], [10n, 10n, 10n, 10n], '0x');
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  context('Deploy Contract', function () {
    it('Deploy with proper ERC1155 contract', async function () {
      await expect(deployContract('GenesisTokenEscrow', this.erc1155Address, this.forwarderRegistryAddress));
    });

    it('Deploy with invalid ERC1155 contract', async function () {
      await expect(deployContract('GenesisTokenEscrow', ethers.ZeroAddress, this.forwarderRegistryAddress)).to.be.revertedWithCustomError(
        this.escrow1155,
        'InvalidInventory'
      );
    });
  });

  context('Deposit via safeTransferFrom', function () {
    it('Deposit 1 Golden backpack for pNFT #1', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [this.erc721Address, 1n]);
      await expect(this.erc1155['safeTransferFrom(address,address,uint256,uint256,bytes)'](deployer.address, this.erc1155EscrowAddress, 1n, 1n, data))
        .to.emit(this.escrow1155, 'Deposited')
        .withArgs(deployer.address, [this.erc721Address], [1n], [[1n, 0]]);
      await expect(await this.escrow1155.escrowed(deployer.address, this.erc721Address, 1)).to.deep.equals([1n, 0]);
    });

    it('Deposit 3 Silver notebook for pNFT #0', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [this.erc721Address, 0]);
      await expect(this.erc1155['safeTransferFrom(address,address,uint256,uint256,bytes)'](deployer.address, this.erc1155EscrowAddress, 2n, 3n, data))
        .to.emit(this.escrow1155, 'Deposited')
        .withArgs(deployer.address, [this.erc721Address], [0], [[0, 3n]]);
      await expect(await this.escrow1155.escrowed(deployer.address, this.erc721Address, 0)).to.deep.equals([0, 3n]);
    });

    it('Deposit unknown Genesis token Id 0, amount 1', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [this.erc721Address, 1n]);
      await expect(this.erc1155['safeTransferFrom(address,address,uint256,uint256,bytes)'](deployer.address, this.erc1155EscrowAddress, 0, 1n, data))
        .to.be.revertedWithCustomError(this.escrow1155, 'UnsupportedGenesisTokenId')
        .withArgs(0);
    });

    it('Deposit unknown Genesis token Id 3, amount 0', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [this.erc721Address, 1n]);
      await expect(this.erc1155['safeTransferFrom(address,address,uint256,uint256,bytes)'](deployer.address, this.erc1155EscrowAddress, 3n, 0, data))
        .to.be.revertedWithCustomError(this.escrow1155, 'UnsupportedGenesisTokenId')
        .withArgs(3n);
    });

    it('Deposit an unsupported ERC1155 contract', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [this.erc721Address, 1n]);
      await expect(
        this.erc1155Unsupported['safeTransferFrom(address,address,uint256,uint256,bytes)'](deployer.address, this.erc1155EscrowAddress, 1n, 1n, data)
      ).to.be.revertedWithCustomError(this.escrow1155, 'InvalidInventory');
    });
  });

  context('Deposit via safeBatchTransferFrom', function () {
    it('Deposit 2 Golden and 1 Silver for pNFT #0', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [0], [2n], [1n]]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n, 2n],
          [2n, 1n],
          data
        )
      )
        .to.emit(this.escrow1155, 'Deposited')
        .withArgs(deployer.address, [this.erc721Address], [0], [[2n, 1n]]);
      await expect(await this.escrow1155.escrowed(deployer.address, this.erc721Address, 0)).to.deep.equals([2n, 1n]);
    });

    it('Deposit 1 Golden and 1 Silver for pNFT #1, 1 Golden for pNFT #2', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [
          [this.erc721Address, this.erc721Address],
          [1n, 2n],
          [1n, 1n],
          [1n, 0n],
        ]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n, 2n],
          [2n, 1n],
          data
        )
      )
        .to.emit(this.escrow1155, 'Deposited')
        .withArgs(
          deployer.address,
          [this.erc721Address, this.erc721Address],
          [1n, 2n],
          [
            [1n, 1n],
            [1n, 0n],
          ]
        );
      await expect(await this.escrow1155.escrowed(deployer.address, this.erc721Address, 1)).to.deep.equals([1n, 1n]);
      await expect(await this.escrow1155.escrowed(deployer.address, this.erc721Address, 2)).to.deep.equals([1n, 0]);
    });

    it('Deposit 1 Golden and 1 Silver for pNFT #0, 1 Golden for an alternative pNFT #1', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [
          [this.erc721Address, this.erc721AddressAlt],
          [0, 1n],
          [1n, 1n],
          [1n, 0n],
        ]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n, 2n],
          [2n, 1n],
          data
        )
      )
        .to.emit(this.escrow1155, 'Deposited')
        .withArgs(
          deployer.address,
          [this.erc721Address, this.erc721AddressAlt],
          [0, 1n],
          [
            [1n, 1n],
            [1n, 0n],
          ]
        );
      await expect(await this.escrow1155.escrowed(deployer.address, this.erc721Address, 0)).to.deep.equals([1n, 1n]);
      await expect(await this.escrow1155.escrowed(deployer.address, this.erc721AddressAlt, 1)).to.deep.equals([1n, 0]);
    });

    it('Deposit 2 Golden for pNFT #0, then deposit 1 Golden and 4 Silver for pNFT #0', async function () {
      const data1 = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [0], [2n], [0]]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n, 2n],
          [2n, 0],
          data1
        )
      )
        .to.emit(this.escrow1155, 'Deposited')
        .withArgs(deployer.address, [this.erc721Address], [0], [[2n, 0]]);
      await expect(await this.escrow1155.escrowed(deployer.address, this.erc721Address, 0)).to.deep.equals([2n, 0]);

      const data2 = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [0], [1n], [4n]]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n, 2n],
          [1n, 4n],
          data2
        )
      )
        .to.emit(this.escrow1155, 'Deposited')
        .withArgs(deployer.address, [this.erc721Address], [0], [[3n, 4n]]);
      await expect(await this.escrow1155.escrowed(deployer.address, this.erc721Address, 0)).to.deep.equals([3n, 4n]);
    });

    it('Deposit 2 Golden, 4 Silver for pNFT #0 separately and withdraw afterward, then deposit 2 Golden, 3 Silver for pNFT #0', async function () {
      const data1 = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [0], [1n], [0]]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n, 2n],
          [1n, 0],
          data1
        )
      )
        .to.emit(this.escrow1155, 'Deposited')
        .withArgs(deployer.address, [this.erc721Address], [0], [[1n, 0]]);
      await expect(await this.escrow1155.escrowed(deployer.address, this.erc721Address, 0)).to.deep.equals([1n, 0]);

      const data2 = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [0], [1n], [4n]]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n, 2n],
          [1n, 4n],
          data2
        )
      )
        .to.emit(this.escrow1155, 'Deposited')
        .withArgs(deployer.address, [this.erc721Address], [0], [[2n, 4n]]);
      await expect(await this.escrow1155.escrowed(deployer.address, this.erc721Address, 0)).to.deep.equals([2n, 4n]);

      await expect(this.escrow1155.withdraw([this.erc721Address], [0]))
        .to.emit(this.escrow1155, 'Withdrawn')
        .withArgs(deployer.address, [this.erc721Address], [0]);

      const data3 = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [0], [2n], [3n]]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n, 2n],
          [2n, 3n],
          data3
        )
      )
        .to.emit(this.escrow1155, 'Deposited')
        .withArgs(deployer.address, [this.erc721Address], [0], [[2n, 3n]]);
      await expect(await this.escrow1155.escrowed(deployer.address, this.erc721Address, 0)).to.deep.equals([2n, 3n]);
    });

    it('Deposit an unsupported ERC1155', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [1n], [0], [0]]
      );
      await expect(
        this.erc1155Unsupported['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n],
          [1n],
          data
        )
      ).to.be.revertedWithCustomError(this.escrow1155, 'InvalidInventory');
    });

    it('Deposit unknown Genesis token id 3', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [1n], [0], [0]]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [3n],
          [1n],
          data
        )
      )
        .to.be.revertedWithCustomError(this.escrow1155, 'UnsupportedGenesisTokenId')
        .withArgs(3n);
    });

    it('Deposit 1 Golden and 1 Silver for pNFT #1, but the data claims it has 2 Golden and 1 Silver', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [1n], [2n], [1n]]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n, 2n],
          [1n, 1n],
          data
        )
      )
        .to.be.revertedWithCustomError(this.escrow1155, 'InsufficientGenesisToken')
        .withArgs(1n);
    });

    it('Deposit 1 Golden and 1 Silver for pNFT #1, but the data claims it has 1 Golden and 2 Silver', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [1n], [1n], [2n]]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n, 2n],
          [1n, 1n],
          data
        )
      )
        .to.be.revertedWithCustomError(this.escrow1155, 'InsufficientGenesisToken')
        .withArgs(2n);
    });

    it('Deposit some Genesis tokens, but the data contains inconsistent array lengths for pNFT address and pNFT tokenId', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [1n, 2n], [2n], [1n]]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n, 2n],
          [2n, 1n],
          data
        )
      ).to.be.revertedWithCustomError(this.escrow1155, 'InconsistentArrayLengths');
    });

    it('Deposit some Genesis tokens, but the data contains inconsistent array lengths for Golden tokenIds and pNFT addresses', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [1n], [1n, 2n], [1n]]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n, 2n],
          [2n, 1n],
          data
        )
      ).to.be.revertedWithCustomError(this.escrow1155, 'InconsistentArrayLengths');
    });

    it('Deposit some Genesis tokens, but the data contains inconsistent array lengths for Silver tokenIds and pNFT addresses', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [1n], [2n], [1n, 2n]]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n, 2n],
          [2n, 0],
          data
        )
      ).to.be.revertedWithCustomError(this.escrow1155, 'InconsistentArrayLengths');
    });

    it('Deposit some Genesis tokens, but the actual transfer amount of Golden(3) is more than what described in data(2)', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [1n], [2n], [2n]]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n, 2n],
          [3n, 2n],
          data
        )
      )
        .to.be.revertedWithCustomError(this.escrow1155, 'ExcessiveGenesisToken')
        .withArgs(1n);
    });

    it('Deposit some Genesis tokens, but the actual transfer amount of Silver(3) is more than what described in data(2)', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [1n], [2n], [2n]]
      );
      await expect(
        this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
          deployer.address,
          this.erc1155EscrowAddress,
          [1n, 2n],
          [2n, 3n],
          data
        )
      )
        .to.be.revertedWithCustomError(this.escrow1155, 'ExcessiveGenesisToken')
        .withArgs(2n);
    });
  });

  context('Withdraw', function () {
    it('Withdraw Genesis tokens from pNFT #1, which it had 0 Golden and 1 Silver being staked', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [1n], [0], [1n]]
      );
      await this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
        deployer.address,
        this.erc1155EscrowAddress,
        [1n, 2n],
        [0, 1n],
        data
      );
      await expect(this.escrow1155.withdraw([this.erc721Address], [1n]))
        .to.emit(this.escrow1155, 'Withdrawn')
        .withArgs(deployer.address, [this.erc721Address], [1n]);
    });

    it('Withdraw Genesis tokens from pNFT #1, which it had 1 Golden and 0 Silver being staked', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [1n], [1n], [0]]
      );
      await this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
        deployer.address,
        this.erc1155EscrowAddress,
        [1n, 2n],
        [1n, 0],
        data
      );
      await expect(this.escrow1155.withdraw([this.erc721Address], [1n]))
        .to.emit(this.escrow1155, 'Withdrawn')
        .withArgs(deployer.address, [this.erc721Address], [1n]);
    });

    it('Withdraw Genesis tokens from pNFT #1, which it had 1 Golden and 1 Silver being staked', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [1n], [1n], [1n]]
      );
      await this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
        deployer.address,
        this.erc1155EscrowAddress,
        [1n, 2n],
        [1n, 1n],
        data
      );
      await expect(this.escrow1155.withdraw([this.erc721Address], [1n]))
        .to.emit(this.escrow1155, 'Withdrawn')
        .withArgs(deployer.address, [this.erc721Address], [1n]);
    });

    it('Withdraw Genesis tokens from pNFT #1 and #2', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [
          [this.erc721Address, this.erc721Address],
          [1n, 2n],
          [1n, 1n],
          [1n, 1n],
        ]
      );
      this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
        deployer.address,
        this.erc1155EscrowAddress,
        [1n, 2n],
        [2n, 2n],
        data
      );
      await expect(this.escrow1155.withdraw([this.erc721Address, this.erc721Address], [1n, 2n]))
        .to.emit(this.escrow1155, 'Withdrawn')
        .withArgs(deployer.address, [this.erc721Address, this.erc721Address], [1n, 2n]);
    });

    it('Withdraw Genesis tokens from pNFT #1, but nothing is escrowed for pNFT #1', async function () {
      await expect(this.escrow1155.withdraw([this.erc721Address], [1n])).to.be.revertedWithCustomError(this.escrow1155, 'NotEscrowed');
    });

    it('Withdraw Genesis tokens from pNFT #1 and #2, but nothing is escrowed for pNFT #2', async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address[]', 'uint256[]', 'uint256[]', 'uint256[]'],
        [[this.erc721Address], [1n], [1n], [1n]]
      );
      this.erc1155['safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'](
        deployer.address,
        this.erc1155EscrowAddress,
        [1n, 2n],
        [1n, 1n],
        data
      );
      await expect(this.escrow1155.withdraw([this.erc721Address], [2n])).to.be.revertedWithCustomError(this.escrow1155, 'NotEscrowed');
    });

    it('Withdraw some Genesis tokens, but pNFT addresses length and pNFT tokenId length are mismatched', async function () {
      await expect(this.escrow1155.withdraw([this.erc721Address], [2n, 3n])).to.be.revertedWithCustomError(
        this.escrow1155,
        'InconsistentArrayLengths'
      );
    });
  });

  context('Meta transaction', function () {
    it('returns the msg.data', async function () {
      await this.escrow1155.__msgData();
    });
  });
});
