// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {ERC2771ContextUpgradeable} from "gelatonetwork-node-sale-contracts/contracts/vendor/ERC2771/ERC2771ContextUpgradeable.sol";
import {Proxied} from "gelatonetwork-node-sale-contracts/contracts/vendor/proxy/Proxied.sol";
import {IReferee} from "gelatonetwork-node-sale-contracts/contracts/interfaces/IReferee.sol";
import {IDelegateRegistry} from "gelatonetwork-node-sale-contracts/contracts/interfaces/IDelegateRegistry.sol";
import {INodeKey} from "gelatonetwork-node-sale-contracts/contracts/interfaces/INodeKey.sol";
import {INodeRewards} from "gelatonetwork-node-sale-contracts/contracts/interfaces/INodeRewards.sol";

contract RefereeMock is ERC2771ContextUpgradeable, Proxied, IReferee {
    using EnumerableMap for EnumerableMap.Bytes32ToBytes32Map;
    using EnumerableSet for EnumerableSet.UintSet;

    IDelegateRegistry public constant DELEGATE_REGISTRY =
        IDelegateRegistry(0x00000000000000447e69651d841bD8D104Bed493);

    uint256 public ATTEST_PERIOD;
    INodeKey public NODE_KEY;

    uint256 public latestFinalizedBatchNumber;
    INodeRewards public nodeRewards;

    mapping(address => bool) public isOracle;
    // nodeKeyId => index of first unclaimed batchNumber in _attestedBatchNumbers set
    mapping(uint256 => uint256) internal _indexOfUnclaimedBatch;
    // nodeKeyId => attested batches
    mapping(uint256 => EnumerableSet.UintSet) internal _attestedBatchNumbers;
    // batchNumber => batch info
    mapping(uint256 => BatchInfo) internal _batchInfo;
    // batchNumber => nodeKeyId(bytes32) => l2StateRoot
    mapping(uint256 => EnumerableMap.Bytes32ToBytes32Map)
        internal _attestations;
    // batchNumber => l2StateRoot => count
    mapping(uint256 => mapping(bytes32 => uint256)) internal _nrOfAttestations;

    modifier onlyOracle() {
        if (!isOracle[_msgSender()]) {
            revert OnlyOracle();
        }
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(
        uint256 _attestPeriod,
        address _nodeKey,
        address trustedForwarder
    ) external initializer {
        ATTEST_PERIOD = _attestPeriod;
        NODE_KEY = INodeKey(_nodeKey);
        __ERC2771Context_init(trustedForwarder);
    }

    function setNodeRewards(address _nodeRewards) external onlyProxyAdmin {
        nodeRewards = INodeRewards(_nodeRewards);

        emit LogSetNodeRewards(_nodeRewards);
    }

    function setOracle(
        address _oracle,
        bool _isOracle
    ) external onlyProxyAdmin {
        isOracle[_oracle] = _isOracle;

        emit LogSetOracle(_oracle, _isOracle);
    }

    function getAttestation(
        uint256 _batchNumber,
        uint256 _nodeKeyId
    ) external view returns (bytes32) {
        (bool hasAttestation, bytes32 l2StateRoot) = _attestations[_batchNumber]
            .tryGet(bytes32(_nodeKeyId));

        return hasAttestation ? l2StateRoot : bytes32("");
    }

    function getAttestedBatchNumbers(
        uint256 _nodeKeyId
    ) external view returns (uint256[] memory) {
        return _attestedBatchNumbers[_nodeKeyId].values();
    }

    function getBatchInfo(
        uint256 _batchNumber
    ) external view returns (BatchInfo memory) {
        return _batchInfo[_batchNumber];
    }

    function getIndexOfUnclaimedBatch(
        uint256 _nodeKeyId
    ) external view returns (uint256) {
        return _indexOfUnclaimedBatch[_nodeKeyId];
    }

    function attest(
        uint256 _batchNumber,
        bytes32 _l2StateRoot,
        uint256 _nodeKeyId
    ) external {
        bool success = _attest(_batchNumber, _l2StateRoot, _nodeKeyId);

        if (success) {
            nodeRewards.onAttest(_batchNumber, _nodeKeyId);
        } else revert AttestFailed();
    }

    function batchAttest(
        uint256 _batchNumber,
        bytes32 _l2StateRoot,
        uint256[] memory _nodeKeyIds
    ) external {
        bool hasSuccessfulAttest;
        uint256 length = _nodeKeyIds.length;
        uint256[] memory successfulNodeKeyIds = new uint256[](length);

        for (uint256 i; i < length; i++) {
            bool success = _attest(_batchNumber, _l2StateRoot, _nodeKeyIds[i]);
            if (success) {
                hasSuccessfulAttest = true;
                successfulNodeKeyIds[i] = _nodeKeyIds[i];
            }
        }

        if (hasSuccessfulAttest) {
            nodeRewards.onBatchAttest(_batchNumber, successfulNodeKeyIds);
        } else revert AttestFailed();
    }

    function finalize(
        uint256 _batchNumber,
        uint256 _l1NodeConfirmedTimestamp,
        bytes32 _finalL2StateRoot
    ) external onlyOracle {
        if (address(nodeRewards) == address(0)) {
            revert NodeRewardsNotSet();
        }

        uint256 prevFinalizedBatchNumber = latestFinalizedBatchNumber;

        if (_batchNumber <= prevFinalizedBatchNumber) {
            revert InvalidBatchNumber();
        }

        uint256 nrOfSuccessfulAttestations = _nrOfAttestations[_batchNumber][
            _finalL2StateRoot
        ];

        _batchInfo[_batchNumber] = BatchInfo({
            nrOfSuccessfulAttestations: nrOfSuccessfulAttestations,
            prevBatchNumber: prevFinalizedBatchNumber,
            l1NodeConfirmedTimestamp: _l1NodeConfirmedTimestamp,
            finalL2StateRoot: _finalL2StateRoot
        });

        nodeRewards.onFinalize(
            _batchNumber,
            _l1NodeConfirmedTimestamp,
            _batchInfo[prevFinalizedBatchNumber].l1NodeConfirmedTimestamp,
            nrOfSuccessfulAttestations
        );

        latestFinalizedBatchNumber = _batchNumber;

        emit LogFinalized(
            _batchNumber,
            _finalL2StateRoot,
            nrOfSuccessfulAttestations
        );
    }

    function claimReward(uint256 _nodeKeyId, uint256 _batchesCount) external {
        _claimReward(_nodeKeyId, _batchesCount);
    }

    function batchClaimReward(
        uint256[] memory _nodeKeyIds,
        uint256 _batchesCount
    ) external {
        for (uint256 i; i < _nodeKeyIds.length; i++) {
            _claimReward(_nodeKeyIds[i], _batchesCount);
        }
    }

    function getUnattestedNodeKeyIds(
        uint256 _batchNumber,
        uint256[] memory _nodeKeyIds
    ) external view returns (uint256[] memory) {
        uint256 length = _nodeKeyIds.length;
        uint256[] memory filteredNodeKeyIds = new uint256[](length);
        for (uint256 i; i < length; i++) {
            bytes32 nodeKeyIdBytes = bytes32(_nodeKeyIds[i]);

            if (!_attestations[_batchNumber].contains(nodeKeyIdBytes)) {
                filteredNodeKeyIds[i] = _nodeKeyIds[i];
            }
        }

        return filteredNodeKeyIds;
    }

    function _attest(
        uint256 _batchNumber,
        bytes32 _l2StateRoot,
        uint256 _nodeKeyId
    ) internal returns (bool) {
        bytes32 nodeKeyIdBytes = bytes32(_nodeKeyId);

        if (_batchNumber <= latestFinalizedBatchNumber) {
            revert InvalidBatchNumber();
        }
        if (
            !_isNodeKeyOperator(_nodeKeyId) ||
            _attestations[_batchNumber].contains(nodeKeyIdBytes)
        ) {
            return false;
        }

        _attestations[_batchNumber].set(nodeKeyIdBytes, _l2StateRoot);
        _attestedBatchNumbers[_nodeKeyId].add(_batchNumber);
        _nrOfAttestations[_batchNumber][_l2StateRoot] += 1;

        emit LogAttest(_batchNumber, _l2StateRoot, _nodeKeyId);

        return true;
    }

    function _claimReward(uint256 _nodeKeyId, uint256 _batchesCount) internal {
        uint256 unclaimedIndex = _indexOfUnclaimedBatch[_nodeKeyId];

        EnumerableSet.UintSet storage batchNumbers = _attestedBatchNumbers[
            _nodeKeyId
        ];

        uint256 maxClaimableBatches = batchNumbers.length() - unclaimedIndex;
        _batchesCount = _batchesCount > maxClaimableBatches
            ? maxClaimableBatches
            : _batchesCount;

        if (_batchesCount == 0) {
            revert NoRewardsToClaim();
        }

        uint256[] memory claimableBatchNumbers = new uint256[](_batchesCount);

        for (uint256 i; i < _batchesCount; i++) {
            uint256 batchNumber = batchNumbers.at(unclaimedIndex);

            if (batchNumber > latestFinalizedBatchNumber) break;
            unclaimedIndex += 1;

            bytes32 attestationL2StateRoot = _attestations[batchNumber].get(
                bytes32(_nodeKeyId)
            );
            bytes32 finalL2StateRoot = _batchInfo[batchNumber].finalL2StateRoot;

            if (finalL2StateRoot == bytes32(0)) continue;

            if (attestationL2StateRoot == finalL2StateRoot) {
                claimableBatchNumbers[i] = batchNumber;
            }
        }

        _indexOfUnclaimedBatch[_nodeKeyId] = unclaimedIndex;

        nodeRewards.claimReward(_nodeKeyId, claimableBatchNumbers);
    }

    function _isNodeKeyOperator(
        uint256 _nodeKeyId
    ) internal view returns (bool) {
        address ownerOfNodeKey = NODE_KEY.ownerOf(_nodeKeyId);

        return
            _msgSender() == ownerOfNodeKey ||
            DELEGATE_REGISTRY.checkDelegateForERC721(
                _msgSender(),
                ownerOfNodeKey,
                address(NODE_KEY),
                _nodeKeyId,
                ""
            );
    }
}

