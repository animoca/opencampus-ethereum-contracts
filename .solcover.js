module.exports = {
  mocha: {
    enableTimeouts: false,
    grep: '@skip-on-coverage', // Find everything with this tag
    invert: true, // Run the grep's inverse set.
  },
  skipFiles: [
    // TODO remove after solidity 0.8.22 is correctly supported
    'vc/events/IssuersDIDRegistryEvents.sol',
    'vc/events/RevocationRegistryEvents.sol',
    'vc/events/OpenCampusCertificateNFTv1Events.sol',
  ],
};
