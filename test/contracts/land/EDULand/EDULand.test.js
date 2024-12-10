const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {deployTokenMetadataResolverWithBaseURI} = require('@animoca/ethereum-contracts/test/helpers/registries');
const {behavesLikeERC721} = require('./behavior/EDULand.behavior');
const {behavesLikeERC721BatchTransfer} = require('./behavior/EDULand.batchtransfer.behavior');
const {behavesLikeERC721Burnable} = require('./behavior/EDULand.burnable.behavior');
const {behavesLikeERC721Mintable} = require('./behavior/EDULand.mintable.behavior');
const {behavesLikeERC721Metadata} = require('./behavior/EDULand.metadata.behavior');

describe('EDULand', function () {
  const name = 'EDU Land';
  const symbol = 'EDULand';
  const deployFn = async function () {
    const metadataResolverAddress = await deployTokenMetadataResolverWithBaseURI();
    const contract = await deployContract('EDULand', name, symbol, metadataResolverAddress);
    return contract;
  };
  const implementation = {
    name,
    symbol,
    errors: {
      // ERC721
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
      NotTransferable: {custom: true, error: 'NotTransferable'},
      NotOperator: {custom: true, error: 'NotRoleHolder', args: ['role', 'account']},
      ApprovalNotAllowed: {custom: true, error: 'ApprovalNotAllowed'},
    },
    features: {
      MetadataResolver: true,
    },
    interfaces: {
      ERC721Burnable: true,
      ERC721Mintable: true,
      ERC721BatchTransfer: true,
    },
    methods: {
      'mint(address,uint256)': async function (contract, to, tokenId, signer) {
        return contract.connect(signer).mint(to, tokenId);
      },
      'safeMint(address,uint256,bytes)': async function (contract, to, tokenId, data, signer) {
        return contract.connect(signer).safeMint(to, tokenId, data);
      },
      'batchMint(address,uint256[])': async function (contract, to, tokenIds, signer) {
        return contract.connect(signer).batchMint(to, tokenIds);
      },
      'burnFrom(address,uint256)': async function (contract, from, id, signer) {
        return contract.connect(signer).burnFrom(from, id);
      },
      'batchBurnFrom(address,uint256[])': async function (contract, from, tokenIds, signer) {
        return contract.connect(signer).batchBurnFrom(from, tokenIds);
      },
      'batchTransferFrom(address,address,uint256[])': async function (contract, from, to, ids, signer) {
        return contract.connect(signer).batchTransferFrom(from, to, ids);
      },
    },
    deploy: async function (deployer, operatorRoleHolder) {
      const contract = await deployFn({name, symbol});
      if (operatorRoleHolder) {
        await contract.grantRole(await contract.OPERATOR_ROLE(), operatorRoleHolder.address);
      }
      return contract;
    },
    mint: async function (contract, to, id, _value, signer) {
      return contract.connect(signer).mint(to, id);
    },
  };

  behavesLikeERC721(implementation);
  behavesLikeERC721BatchTransfer(implementation);
  behavesLikeERC721Burnable(implementation);
  behavesLikeERC721Mintable(implementation);
  behavesLikeERC721Metadata(implementation);
});
