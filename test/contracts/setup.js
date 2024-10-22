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
    this.EDUToken.getAddress(),
    payoutWallet.address,
    deployer.address,
    await getForwarderRegistryAddress()
  );
  await this.EDUToken.approve(this.creditsManager.getAddress(), 1000);
}

async function setupPublisherNFTSale(deployer, user, payoutWallet, other, genesisNft1Holder, genesisNft2Holder) {
  await setupEDUCreditsManager.call(this, deployer, user, payoutWallet);

  await this.creditsManager.setInitialCredits(
    [user.address, genesisNft1Holder.address, genesisNft2Holder.address],
    [300, 100, 100],
    [0, 0, 0],
    [true, false, false]
  );
  await this.creditsManager.setPhase(await this.creditsManager.SALE_PHASE());
  this.genesisToken = await deployContract(
    'ERC1155Full',
    '',
    '',
    ethers.ZeroAddress,
    await getOperatorFilterRegistryAddress(),
    await getForwarderRegistryAddress()
  );
  await this.genesisToken.grantRole(await this.genesisToken.MINTER_ROLE(), deployer.address);
  await this.genesisToken.safeDeliver([genesisNft1Holder.address, genesisNft2Holder.address], [1, 2], [1, 1], '0x');
  this.lzEndpoint = await deployContract('LzEndpointMock');
  const now = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp;
  const phase1Start = now + 10000;
  const phase2Start = phase1Start + 10000;
  const phase3Start = phase2Start + 10000;
  const saleEnd = phase3Start + 10000;

  this.sale = await deployContract(
    'PublisherNFTSaleMock',
    this.genesisToken.getAddress(),
    this.creditsManager.getAddress(),
    this.lzEndpoint.getAddress(),
    1, // lzDstChainId
    100, // mintPrice
    3, // mintSupplyLimit
    2, // mintLimitPerAddress
    [phase1Start, phase2Start, phase3Start, saleEnd], // timestamps
    // [10000, 20000, 30000, 40000], // timestamps
    [1000, 2000, 3000], // discountThresholds
    [500, 1000, 1500], // discountPercentages
    await getForwarderRegistryAddress()
  );
  await this.creditsManager.grantRole(await this.creditsManager.SPENDER_ROLE(), this.sale.getAddress());
  await deployer.sendTransaction({
    to: await this.sale.getAddress(),
    value: ethers.parseEther('10.0'),
  });
}

async function setupPublisherNFTMinter(deployer, user, payoutWallet, other, genesisNft1Holder, genesisNft2Holder) {
  await setupPublisherNFTSale.call(this, deployer, user, payoutWallet, other, genesisNft1Holder, genesisNft2Holder);
  this.publisherNFT = await deployContract(
    'ERC721Full',
    '',
    '',
    ethers.ZeroAddress,
    await getOperatorFilterRegistryAddress(),
    await getForwarderRegistryAddress()
  );

  this.minter = await deployContract(
    'PublisherNFTMinter',
    this.publisherNFT.getAddress(),
    this.lzEndpoint.getAddress(),
    0, // lzSrcChainId
    this.sale.getAddress(), // lzSrcAddress
    2 // mintSupplyLimit
  );

  await this.sale.setLzDstAddress(this.minter.getAddress());
  await this.publisherNFT.grantRole(await this.publisherNFT.MINTER_ROLE(), this.minter.getAddress());
}

async function setupOpenCampusIssuersDIDRegistry(deployer, user, payoutWallet) {
  await setupEDUCreditsManager.call(this, deployer, user, payoutWallet);
  this.didRegistry = await deployContract('OpenCampusIssuersDIDRegistry');
}

async function setupOpenCampusRevocationRegistry(deployer, user, payoutWallet) {
  await setupEDUCreditsManager.call(this, deployer, user, payoutWallet);
  this.didRegistry = await deployContract('OpenCampusIssuersDIDRegistry');
  await this.didRegistry.grantRole(await this.didRegistry.OPERATOR_ROLE(), deployer);
  this.revocationRegistry = await deployContract('OpenCampusCertificateRevocationRegistry', this.didRegistry.getAddress());
}

async function setupOpenCampusCertificateNFTv1(deployer, user, payoutWallet) {
  await setupEDUCreditsManager.call(this, deployer, user, payoutWallet);
  this.didRegistry = await deployContract('OpenCampusIssuersDIDRegistry');
  await this.didRegistry.grantRole(await this.didRegistry.OPERATOR_ROLE(), deployer);
  this.revocationRegistry = await deployContract('OpenCampusCertificateRevocationRegistry', this.didRegistry.getAddress());
  this.ocNFT = await deployContract(
    'OpenCampusCertificateNFTv1',
    '',
    '',
    ethers.ZeroAddress,
    this.revocationRegistry.getAddress(),
    this.didRegistry.getAddress()
  );
  this.erc721ReceiverAccept = await deployContract('ERC721ReceiverMock', true, this.ocNFT.getAddress());
  this.erc721ReceiverReject = await deployContract('ERC721ReceiverMock', false, this.ocNFT.getAddress());
  await this.ocNFT.grantRole(await this.ocNFT.MINTER_ROLE(), deployer);
  await this.ocNFT.grantRole(await this.ocNFT.OPERATOR_ROLE(), deployer);
}

async function setupOpenCampusCertificateNFTMinter(deployer, user, payoutWallet) {
  await setupEDUCreditsManager.call(this, deployer, user, payoutWallet);
  this.didRegistry = await deployContract('OpenCampusIssuersDIDRegistry');
  this.revocationRegistry = await deployContract('OpenCampusCertificateRevocationRegistry', this.didRegistry.getAddress());
  this.ocNFT = await deployContract(
    'OpenCampusCertificateNFTv1',
    '',
    '',
    ethers.ZeroAddress,
    this.revocationRegistry.getAddress(),
    this.didRegistry.getAddress()
  );
  this.ocMinter = await deployContract(
    'OpenCampusCertificateNFTMinter',
    this.didRegistry.getAddress(),
    this.ocNFT.getAddress(),
    this.revocationRegistry.getAddress()
  );
  await this.didRegistry.grantRole(await this.didRegistry.OPERATOR_ROLE(), deployer);
  await this.ocNFT.grantRole(await this.ocNFT.MINTER_ROLE(), this.ocMinter);
}

module.exports = {
  setupEDUCreditsManager,
  setupPublisherNFTSale,
  setupPublisherNFTMinter,
  setupOpenCampusIssuersDIDRegistry,
  setupOpenCampusCertificateNFTv1,
  setupOpenCampusCertificateNFTMinter,
  setupOpenCampusRevocationRegistry,
};
