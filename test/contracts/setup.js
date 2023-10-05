const {ethers} = require('hardhat');
const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {getForwarderRegistryAddress, getOperatorFilterRegistryAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');

async function setupEDUCreditsManager(deployer, user, payoutWallet) {
  this.EDUToken = await deployContract(
    'ERC20FixedSupply',
    '',
    '',
    18,
    [user.address, deployer.address],
    [1000000000, 1000000000],
    await getForwarderRegistryAddress()
  );
  this.creditsManager = await deployContract(
    'EDUCreditsManagerMock',
    this.EDUToken.address,
    payoutWallet.address,
    deployer.address,
    await getForwarderRegistryAddress()
  );
  await this.EDUToken.approve(this.creditsManager.address, 1000);
}

async function setupPublisherNFTSale(deployer, user, payoutWallet, other, genesisNft0Holder, genesisNft1Holder) {
  await setupEDUCreditsManager.call(this, deployer, user, payoutWallet);

  await this.creditsManager.setInitialCredits(
    [user.address, genesisNft0Holder.address, genesisNft1Holder.address],
    [300, 100, 100],
    [0, 0, 0],
    [true, false, false]
  );
  await this.creditsManager.setPhase(await this.creditsManager.SALE_PHASE());
  this.genesisToken = await deployContract(
    'ERC1155Full',
    '',
    '',
    ethers.constants.AddressZero,
    await getOperatorFilterRegistryAddress(),
    await getForwarderRegistryAddress()
  );
  await this.genesisToken.grantRole(await this.genesisToken.MINTER_ROLE(), deployer.address);
  await this.genesisToken.safeDeliver([genesisNft0Holder.address, genesisNft1Holder.address], [0, 1], [1, 1], '0x');
  this.lzEndpoint = await deployContract('LzEndpointMock');
  const now = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp;
  const phase1Start = now + 10000;
  const phase2Start = phase1Start + 10000;
  const phase3Start = phase2Start + 10000;
  const saleEnd = phase3Start + 10000;

  this.sale = await deployContract(
    'PublisherNFTSaleMock',
    this.genesisToken.address,
    this.creditsManager.address,
    this.lzEndpoint.address,
    1, // lzDstChainId
    100, // mintPrice
    3, // mintSupplyLimit
    2, // mintLimitPerAddress
    [phase1Start, phase2Start, phase3Start, saleEnd], // timestamps
    // [10000, 20000, 30000, 40000], // timestamps
    [1000, 2000, 3000], // discountThresholds
    [5, 10, 15], // discountPercentages
    await getForwarderRegistryAddress()
  );
  await this.creditsManager.grantRole(await this.creditsManager.SPENDER_ROLE(), this.sale.address);
  await deployer.sendTransaction({
    to: this.sale.address,
    value: ethers.utils.parseEther('10.0'),
  });
}

async function setupPublisherNFTMinter(deployer, user, payoutWallet, other, genesisNft0Holder, genesisNft1Holder) {
  await setupPublisherNFTSale.call(this, deployer, user, payoutWallet, other, genesisNft0Holder, genesisNft1Holder);
  this.publisherNFT = await deployContract(
    'ERC721Full',
    '',
    '',
    ethers.constants.AddressZero,
    await getOperatorFilterRegistryAddress(),
    await getForwarderRegistryAddress()
  );

  this.minter = await deployContract(
    'PublisherNFTMinter',
    this.publisherNFT.address,
    this.lzEndpoint.address,
    0, // lzSrcChainId
    this.sale.address, // lzSrcAddress
    2 // mintSupplyLimit
  );

  await this.sale.setLzDstAddress(this.minter.address);
  await this.publisherNFT.grantRole(await this.publisherNFT.MINTER_ROLE(), this.minter.address);
}

module.exports = {
  setupEDUCreditsManager,
  setupPublisherNFTSale,
  setupPublisherNFTMinter,
};
