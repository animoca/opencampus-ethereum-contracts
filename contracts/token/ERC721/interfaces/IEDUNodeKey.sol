// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IERC721Mintable} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721Mintable.sol";
import {IERC721Deliverable} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721Deliverable.sol";
import {IERC721Burnable} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721Burnable.sol";

interface IEDUNodeKey is IERC721Mintable, IERC721Deliverable, IERC721Burnable {
    /// @inheritdoc IERC721Mintable
    function mint(address to, uint256 tokenId) external;

    /// @inheritdoc IERC721Mintable
    function safeMint(address to, uint256 tokenId, bytes calldata data) external;

    /// @inheritdoc IERC721Mintable
    function batchMint(address to, uint256[] calldata tokenIds) external;

    /// @inheritdoc IERC721Deliverable
    function deliver(address[] calldata recipients, uint256[] calldata tokenIds) external;
}
