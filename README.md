# Open Campus Ethereum Contracts

[![NPM Package](https://img.shields.io/npm/v/@animoca/opencampus-ethereum-contracts.svg)](https://www.npmjs.org/package/@animoca/opencampus-ethereum-contracts)
[![Coverage Status](https://codecov.io/gh/animoca/opencampus-ethereum-contracts/graph/badge.svg)](https://codecov.io/gh/animoca/opencampus-ethereum-contracts)

Solidity contracts for the Open Campus project.

## Audits

| Date       | Scope        | Commit                                                                                                                                  | Package version                                                            | Auditor                             | Report                                                                                    |
| ---------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| 18/10/2023 | sale/PublisherNFTMinter.sol sale/PublisherNFTSale.sol  | [3ec9be0e99a9b32620b1b302b4e83d4fcacf44d4](https://github.com/animoca/ethereum-contracts/tree/3ec9be0e99a9b32620b1b302b4e83d4fcacf44d4) | [1.0.0](https://www.npmjs.com/package/@animoca/ethereum-contracts/v/1.0.0) | [Solidified](https://solidified.io)    | [link](/audit/Audit%20Report%20-%20Animoca%20Open%20Campus%20Contracts%20%5B18.10.2023%5D-final.pdf)   |

## Development

Install the dependencies:

```bash
yarn
```

Compile the contracts:

```bash
yarn compile
```

Run the tests:

```bash
yarn test
# or
yarn test-p # parallel mode
```

Run the coverage tests:

```bash
yarn coverage
```

Run the full pipeline (should be run before commiting code):

```bash
yarn run-all
```

See `package.json` for additional commands.

Note: this repository uses git lfs: the module should be installed before pushing changes.
