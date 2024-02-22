const {ethers} = require('hardhat');
const {expect} = require('chai');
const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {getForwarderRegistryAddress, getTokenMetadataResolverPerTokenAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');

describe('PublisherNFTEscrow', function () {
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
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  context('Deploy Contract', function () {
    it('Empty supported ERC721 list', async function () {
      this.escrow721 = await deployContract('PublisherNFTEscrowMock', [], this.forwarderRegistryAddress);
    });

    it('Add Zero address ERC721', async function () {
      await expect(
        deployContract('PublisherNFTEscrowMock', [this.erc721Address, ethers.ZeroAddress], this.forwarderRegistryAddress)
      ).to.be.revertedWithCustomError(this.escrow721, 'UnsupportedInventory');
    });
  });

  context('Deposit()', function () {
    beforeEach(async function () {
      await this.erc721.safeMint(deployer.address, '1', '0x');
    });

    it('Deposit ERC721 with deposit function', async function () {
      await this.erc721.setApprovalForAll(this.erc721EscrowAddress, true);
      await expect(this.escrow721.deposit([this.erc721Address], ['1']))
        .to.emit(this.escrow721, 'Deposited')
        .withArgs(deployer.address, [this.erc721Address], ['1']);
      expect(await this.escrow721.escrowed(this.erc721Address, '1')).is.equals(deployer.address);
    });

    it('Deposit ERC721 with deposit function with inconsistent array lengths args, should revert', async function () {
      await this.erc721.setApprovalForAll(this.erc721EscrowAddress, true);
      await expect(this.escrow721.deposit([this.erc721Address], ['1', '2'])).to.be.revertedWithCustomError(this.escrow721, 'InconsistentArrayLengths');
    });
  });

  context('Deposit via safeTransferFrom', function () {
    beforeEach(async function () {
      await this.erc721.safeMint(deployer.address, '1', '0x');
    });

    it('Deposit ERC721 with safeTransferFrom function', async function () {
      await expect(this.erc721['safeTransferFrom(address,address,uint256)'](deployer.address, this.erc721EscrowAddress, '1'))
        .to.emit(this.escrow721, 'Deposited')
        .withArgs(deployer.address, [this.erc721Address], ['1']);
      expect(await this.escrow721.escrowed(this.erc721Address, '1')).is.equals(deployer.address);
    });
  });

  context('Withdraw', function () {
    beforeEach(async function () {
      await this.erc721.safeMint(deployer.address, '2', '0x');
      await this.erc721['safeTransferFrom(address,address,uint256)'](deployer.address, this.erc721EscrowAddress, '2');
    });

    it('Withdraw pNFT #2', async function () {
      await expect(this.escrow721.withdraw([this.erc721Address], ['2']))
        .to.emit(this.escrow721, 'Withdrawn')
        .withArgs(deployer.address, [this.erc721Address], ['2']);
    });

    it('Withdraw ERC721 with inconsistent array lengths args, should revert', async function () {
      await expect(this.escrow721.withdraw([this.erc721Address], ['1', '2'])).to.be.revertedWithCustomError(this.escrow721, 'InconsistentArrayLengths');
    });

    it('Withdraw ERC721 that staked by another wallet, should fail', async function () {
      await expect(this.escrow721.connect(wallet1).withdraw([this.erc721Address], ['2'])).to.be.revertedWithCustomError(this.escrow721, 'NotEscrowed');
    });

    it('Withdraw ERC721 that is not escrowed, should fail', async function () {
      await expect(this.escrow721.connect(wallet1).withdraw([this.erc721Address], ['3'])).to.be.revertedWithCustomError(this.escrow721, 'NotEscrowed');
    });
  });

  context('ERC721 Whitelist management', function () {
    beforeEach(async function () {
      this.erc721NonWhitelisted = await deployContract(
        'ERC721Full',
        '',
        '',
        this.metadataResolverAddress,
        ethers.ZeroAddress,
        this.forwarderRegistryAddress
      );
      await this.erc721NonWhitelisted.grantRole(await this.erc721.MINTER_ROLE(), deployer.address);
      await this.erc721NonWhitelisted.safeMint(deployer.address, '1', '0x');
    });

    it('Deposit a non-whitelisted ERC721 with safeTransferFrom, should revert', async function () {
      await expect(
        this.erc721NonWhitelisted['safeTransferFrom(address,address,uint256)'](deployer.address, this.erc721EscrowAddress, '1')
      ).to.be.revertedWithCustomError(this.escrow721, 'UnsupportedInventory');
    });

    it('Deposit a non-whitelisted ERC721 with deposit(), should revert', async function () {
      await expect(
        this.escrow721.deposit([this.erc721NonWhitelisted], ['1'])
      ).to.be.revertedWithCustomError(this.escrow721, 'UnsupportedInventory');
    });

    it('Add a new ERC721 to whitelist', async function () {
      const erc721Address = await this.erc721NonWhitelisted.getAddress();
      await expect(this.escrow721.addSupportedInventory(erc721Address)).to.emit(this.escrow721, 'SupportedInventoryAdded').withArgs(erc721Address);
      expect(await this.escrow721.supportedInventories(erc721Address)).is.not.null;

      await expect(this.erc721NonWhitelisted['safeTransferFrom(address,address,uint256)'](deployer.address, this.erc721EscrowAddress, '1'))
        .to.emit(this.escrow721, 'Deposited')
        .withArgs(deployer.address, [erc721Address], ['1']);

      await expect(this.escrow721.removeSupportedInventory(erc721Address)).to.emit(this.escrow721, 'SupportedInventoryRemoved').withArgs(erc721Address);
    });

    it('Add empty address as ERC721 to whitelist', async function () {
      await expect(this.escrow721.addSupportedInventory(ethers.ZeroAddress)).to.be.revertedWithCustomError(this.escrow721, 'UnsupportedInventory');
    });

    it('Remove a ERC721 from whitelist', async function () {
      await expect(this.escrow721.removeSupportedInventory(this.erc721Address))
        .to.emit(this.escrow721, 'SupportedInventoryRemoved')
        .withArgs(this.erc721Address);
      expect(await this.escrow721.supportedInventories(this.erc721Address)).is.not.null;

      await this.erc721.safeMint(deployer.address, '1', '0x');
      await expect(
        this.erc721['safeTransferFrom(address,address,uint256)'](deployer.address, this.erc721EscrowAddress, '1')
      ).to.be.revertedWithCustomError(this.escrow721, 'UnsupportedInventory');
    });

    it('Remove empty address as ERC721 to whitelist', async function () {
      await expect(this.escrow721.removeSupportedInventory(ethers.ZeroAddress)).to.be.revertedWithCustomError(this.escrow721, 'UnsupportedInventory');
    });

    it('Withdraw an ERC721 token even that ERC721 was removed from the whitelist', async function () {
      await this.erc721.safeMint(deployer.address, '1', '0x');
      await this.erc721['safeTransferFrom(address,address,uint256)'](deployer.address, this.erc721EscrowAddress, '1');

      await this.escrow721.removeSupportedInventory(this.erc721Address);
      await expect(this.escrow721.withdraw([this.erc721Address], ['1']))
        .to.emit(this.escrow721, 'Withdrawn')
        .withArgs(deployer.address, [this.erc721Address], ['1']);
    });
  });

  context('recoverERC721s', function () {
    beforeEach(async function () {
      await this.erc721.safeMint(deployer.address, '1', '0x');
    });

    it('recover a non escrowed token', async function () {
      await this.erc721.transferFrom(deployer.address, this.erc721EscrowAddress, '1');
      await expect(this.escrow721.recoverERC721s([deployer.address], [this.erc721Address], [1]));
    });

    it('recover a non escrowed token but in the case of InconsistentArrayLengths', async function () {
      await this.erc721.transferFrom(deployer.address, this.erc721EscrowAddress, '1');
      await expect(this.escrow721.recoverERC721s([deployer.address], [this.erc721Address, this.erc721Address], [1])).to.be.revertedWithCustomError(this.escrow721, 'InconsistentArrayLengths');
      await expect(this.escrow721.recoverERC721s([deployer.address], [this.erc721Address], [1, 2])).to.be.revertedWithCustomError(this.escrow721, 'InconsistentArrayLengths');
    });

    it('recover an escrowed token should fail', async function () {
      await expect(this.erc721['safeTransferFrom(address,address,uint256)'](deployer.address, this.erc721EscrowAddress, '1'))
      .to.emit(this.escrow721, 'Deposited')
      .withArgs(deployer.address, [this.erc721Address], ['1']);
      await expect(this.escrow721.recoverERC721s([deployer.address], [this.erc721Address], [1])).to.be.revertedWithCustomError(this.escrow721, 'NotRecoverable');
    });
  });

  context('Meta transaction', function () {
    it('returns the msg.data', async function () {
      await this.escrow721.__msgData();
    });
  });
});
