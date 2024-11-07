const {runBehaviorTests} = require('@animoca/ethereum-contract-helpers/src/test/run');
const {getForwarderRegistryAddress, getTokenMetadataResolverWithBaseURIAddress} = require('@animoca/ethereum-contracts/test/helpers/registries');
const {behavesLikeERC721Mintable} = require('@animoca/ethereum-contracts/test/contracts/token/ERC721/behaviors/ERC721.mintable.behavior');
const {behavesLikeERC721Deliverable} = require('@animoca/ethereum-contracts/test/contracts/token/ERC721/behaviors/ERC721.deliverable.behavior');
const {behavesLikeERC721Metadata} = require('@animoca/ethereum-contracts/test/contracts/token/ERC721/behaviors/ERC721.metadata.behavior');
const {behavesLikeStandard} = require('./behavior/EDUNodeKey.behavior');
const {behavesLikeBatchTransfer} = require('./behavior/EDUNodeKey.batchtransfer.behavior');

const name = 'EDU Principal Node Key';
const symbol = 'EDUKey';

const config = {
  immutable: {
    name: 'EDUNodeKeyMock',
    ctorArguments: ['name', 'symbol', 'metadataResolver', 'forwarderRegistry'],
    testMsgData: true,
  },
  defaultArguments: {
    forwarderRegistry: getForwarderRegistryAddress,
    metadataResolver: getTokenMetadataResolverWithBaseURIAddress,
    name,
    symbol,
  },
};

runBehaviorTests('EDUNodeKeyMock', config, function (deployFn) {
  const implementation = {
    name,
    symbol,
    errors: {
      // ERC721
      SelfApproval: {custom: true, error: 'ERC721SelfApproval', args: ['account']},
      SelfApprovalForAll: {custom: true, error: 'ERC721SelfApprovalForAll', args: ['account']},
      NonApprovedForApproval: {custom: true, error: 'ERC721NonApprovedForApproval', args: ['sender', 'owner', 'tokenId']},
      TransferToAddressZero: {custom: true, error: 'ERC721TransferToAddressZero'},
      NonExistingToken: {custom: true, error: 'ERC721NonExistingToken', args: ['tokenId']},
      NonOwnedToken: {custom: true, error: 'ERC721NonOwnedToken', args: ['account', 'tokenId']},
      SafeTransferRejected: {custom: true, error: 'ERC721SafeTransferRejected', args: ['recipient', 'tokenId']},
      BalanceOfAddressZero: {custom: true, error: 'ERC721BalanceOfAddressZero'},

      // ERC721Mintable
      MintToAddressZero: {custom: true, error: 'ERC721MintToAddressZero'},
      ExistingToken: {custom: true, error: 'ERC721ExistingToken', args: ['tokenId']},

      // Misc
      InconsistentArrayLengths: {custom: true, error: 'InconsistentArrayLengths'},
      NotMinter: {custom: true, error: 'NotRoleHolder', args: ['role', 'account']},

      // transferFrom/ batchTransferFrom
      NotOperator: {custom: true, error: 'NotRoleHolder', args: ['role', 'account']},
    },
    features: {
      MetadataResolver: true,
    },
    methods: {
      'batchTransferFrom(address,address,uint256[])': async function (contract, from, to, ids, signer) {
        return contract.connect(signer).batchTransferFrom(from, to, ids);
      },
      'mint(address,uint256)': async function (contract, to, tokenId, signer) {
        return contract.connect(signer).mint(to, tokenId);
      },
      'safeMint(address,uint256,bytes)': async function (contract, to, tokenId, data, signer) {
        return contract.connect(signer).safeMint(to, tokenId, data);
      },
      'batchMint(address,uint256[])': async function (contract, to, tokenIds, signer) {
        return contract.connect(signer).batchMint(to, tokenIds);
      },
    },
    deploy: async function (deployer) {
      const contract = await deployFn({name, symbol});
      await contract.grantRole(await contract.MINTER_ROLE(), deployer.address);
      return contract;
    },
    mint: async function (contract, to, id, _value) {
      return contract.mint(to, id);
    },
    tokenMetadata: async function (contract, id) {
      return contract.tokenURI(id);
    },
  };

  behavesLikeStandard(implementation);
  behavesLikeBatchTransfer(implementation);

  behavesLikeERC721Mintable(implementation);
  behavesLikeERC721Deliverable(implementation);
  behavesLikeERC721Metadata(implementation);
});
