// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {AccessControl} from "@animoca/ethereum-contracts/contracts/access/AccessControl.sol";
import {ContractOwnership} from "@animoca/ethereum-contracts/contracts/access/ContractOwnership.sol";
import {AccessControlStorage} from "@animoca/ethereum-contracts/contracts/access/libraries/AccessControlStorage.sol";
import {IIssuersDIDRegistry} from "./interfaces/IIssuersDIDRegistry.sol";
import {IssuerAdded, IssuerRemoved} from "./events/IssuersDIDRegistryEvents.sol";

/// @title OpenCampusIssuersDIDRegistry.
/// @notice A registry storing the valid issusers based on eth address.
contract OpenCampusIssuersDIDRegistry is AccessControl, IIssuersDIDRegistry {
    using AccessControlStorage for AccessControlStorage.Layout;

    bytes32 public constant OPERATOR_ROLE = "operator";
    mapping(bytes32 => mapping(address => bool)) public issuers;

    /// @notice Thrown when issuer input is invalid.
    error InvalidIssuer();

    /// @notice Thrown when a given did and issuerAddress relationship does not exist.
    error RelationshipDoesNotExist(bytes32 hashedDid, address issuer);

    constructor() ContractOwnership(msg.sender) {}

    /// @dev Reverts with `NotRoleHolder` if sender does not have `operator` role.
    /// @dev Reverts with `InvalidIssuer` if `did` is empty or `issuerAddress` is zero.
    /// @dev Emits a {IssuerAdded} event when an issuer is added.
    /// @param did DID of the issuer.
    /// @param issuerAddress The Eth address of the issuer.
    function addIssuer(string calldata did, address issuerAddress) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, msg.sender);

        if (bytes(did).length == 0 || issuerAddress == address(0)) {
            revert InvalidIssuer();
        }

        bytes32 hashedDid = keccak256(bytes(did));
        issuers[hashedDid][issuerAddress] = true;
        emit IssuerAdded(hashedDid, issuerAddress, msg.sender);
    }

    /// @dev Reverts with `NotRoleHolder` if sender does not have `operator` role.
    /// @dev Reverts with `RelationshipDoesNotExist` if relationship does not exist between the given did and issuerAddress
    /// @dev Emits a {IssuerRemoved} event when an issuer is removed.
    /// @param did DID of the issuer to be removed.
    /// @param issuerAddress The Eth address of the issuer.
    function removeIssuer(string calldata did, address issuerAddress) external {
        AccessControlStorage.layout().enforceHasRole(OPERATOR_ROLE, msg.sender);
        bytes32 hashedDid = keccak256(bytes(did));

        if (!issuers[hashedDid][issuerAddress]) {
            revert RelationshipDoesNotExist(hashedDid, issuerAddress);
        }

        delete issuers[hashedDid][issuerAddress];
        emit IssuerRemoved(hashedDid, issuerAddress, msg.sender);
    }

    /// @dev returns true if the issuer with given Eth Address and did association is included in this registry
    /// @param did The hashed value of the issuerDid
    /// @param issuerAddress The Eth address of the issuer
    function isIssuerAllowed(string calldata did, address issuerAddress) external view returns (bool allowed) {
        bytes32 hashedDid = keccak256(bytes(did));
        return issuers[hashedDid][issuerAddress];
    }
}
