module.exports = {
  external: {
    contracts: [
      {
        artifacts: 'node_modules/@animoca/ethereum-contracts/artifacts',
      },
      {
        artifacts: ['node_modules/opencampus-xyz/EDU-smart-contract/artifacts'],
      },
      {
        artifacts: 'node_modules/@animoca/anichess-ethereum-contracts-2.2.3/artifacts',
      },
      {
        artifacts: 'node_modules/@gelatonetwork/node-sale-rewards/artifacts',
      },
    ],
  },
};
