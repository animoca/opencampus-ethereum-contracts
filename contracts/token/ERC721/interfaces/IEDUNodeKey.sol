// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {IERC721Mintable} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721Mintable.sol";
import {IERC721} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721.sol";
import {IERC721Burnable} from "@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721Burnable.sol";

interface IEDUNodeKey is IERC721Mintable, IERC721, IERC721Burnable {
}
