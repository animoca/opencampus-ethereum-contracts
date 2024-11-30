module.exports = {
  networks: {
    hardhat: {
      // chainId 31337
      forking: {
        url: 'https://rpc.open-campus-codex.gelato.digital',

        // require DelegateRegistry to be deployed:
        // https://edu-chain-testnet.blockscout.com/address/0x00000000000000447e69651d841bD8D104Bed493
        blockNumber: 147,
      },
    },
  },
};
