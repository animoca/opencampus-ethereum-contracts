// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IERC721} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721.sol";
import {IERC721Mintable} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721Mintable.sol";
import {IERC721Burnable} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721Burnable.sol";
import {IERC721BatchTransfer} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721BatchTransfer.sol";

interface IEDUNodeKey is IERC721, IERC721Mintable, IERC721Burnable, IERC721BatchTransfer {}
