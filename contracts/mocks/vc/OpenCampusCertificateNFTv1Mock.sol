// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IForwarderRegistry} from "@animoca/ethereum-contracts/contracts/metatx/interfaces/IForwarderRegistry.sol";
import {ITokenMetadataResolver} from "@animoca/ethereum-contracts/contracts/token/metadata/interfaces/ITokenMetadataResolver.sol";
import {IIssuersDIDRegistry} from "./../../vc/interfaces/IIssuersDIDRegistry.sol";
import {IRevocationRegistry} from "./../../vc/interfaces/IRevocationRegistry.sol";
import {OpenCampusCertificateNFTv1} from "./../../vc/OpenCampusCertificateNFTv1.sol";

contract OpenCampusCertificateNFTv1Mock is OpenCampusCertificateNFTv1 {
    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        IForwarderRegistry forwarderRegistry,
        ITokenMetadataResolver metadataResolver,
        IRevocationRegistry revocationRegistry,
        IIssuersDIDRegistry didRegistry
    ) OpenCampusCertificateNFTv1(tokenName, tokenSymbol, forwarderRegistry, metadataResolver, revocationRegistry, didRegistry) {}

    function __msgData() external view returns (bytes calldata) {
        return _msgData();
    }
}
