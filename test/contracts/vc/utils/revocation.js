const {network} = require('hardhat');
const {SigningKey, keccak256, toUtf8Bytes, getBytes, TypedDataEncoder} = require('ethers');

class RevocationUtil {
  constructor(defaultPrivateKey, contractAddress) {
    this.domain = {
      name: 'RevocationRegistryV1',
      chainId: network.config.chainId,
      verifyingContract: contractAddress,
    };
    this.defaultPrivateKey = defaultPrivateKey;
  }

  async makePayloadAndSignature(issuerDid, tokenId, privateKey) {
    const hashedDid = keccak256(toUtf8Bytes(issuerDid));
    let value = {};
    let type = {};
    if (Array.isArray(tokenId)) {
      value = {
        hashedIssuerDid: hashedDid,
        vcIds: tokenId,
      };
      type = {
        batchRevokeVCs: [
          {name: 'hashedIssuerDid', type: 'bytes32'},
          {name: 'vcIds', type: 'uint256[]'},
        ],
      };
    } else {
      value = {
        hashedIssuerDid: hashedDid,
        vcId: tokenId,
      };
      type = {
        revokeVC: [
          {name: 'hashedIssuerDid', type: 'bytes32'},
          {name: 'vcId', type: 'uint256'},
        ],
      };
    }
    const signingKey = new SigningKey(privateKey || this.defaultPrivateKey);
    const signature = signingKey.sign(TypedDataEncoder.hash(this.domain, type, value)).serialized;
    return {
      hashedDid,
      tokenId,
      signature: getBytes(signature),
    };
  }
}

module.exports = {RevocationUtil};
