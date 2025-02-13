// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

interface IEDULandRewards {
    function addKycWallets(address[] calldata _wallets) external;

    function removeKycWallets(address[] calldata _wallets) external;
}
