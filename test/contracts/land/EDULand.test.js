const {ethers} = require('hardhat');
const {expect} = require('chai');
const {expectRevert} = require('@animoca/ethereum-contract-helpers/src/test/revert');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {deployTokenMetadataResolverWithBaseURI} = require('@animoca/ethereum-contracts/test/helpers/registries');
const {supportsInterfaces} = require('@animoca/ethereum-contracts/test/contracts/introspection/behaviors/SupportsInterface.behavior');

describe('EDULand', function () {
  const name = 'EDU Land';
  const symbol = 'EDULand';

  const nft1 = 1;
  const nft2 = 2;
  const nft3 = 3;
  const unknownNFT = 1000;

  const errors = {
    // ERC721
    TransferToAddressZero: {custom: true, error: 'ERC721TransferToAddressZero'},
    NonExistingToken: {custom: true, error: 'ERC721NonExistingToken', args: ['tokenId']},
    NonOwnedToken: {custom: true, error: 'ERC721NonOwnedToken', args: ['account', 'tokenId']},
    SafeTransferRejected: {custom: true, error: 'ERC721SafeTransferRejected', args: ['recipient', 'tokenId']},
    BalanceOfAddressZero: {custom: true, error: 'ERC721BalanceOfAddressZero'},

    // ERC721Mintable
    MintToAddressZero: {custom: true, error: 'ERC721MintToAddressZero'},
    ExistingToken: {custom: true, error: 'ERC721ExistingToken', args: ['tokenId']},

    // Misc
    NotOperator: {custom: true, error: 'NotRoleHolder', args: ['role', 'account']},
    ApprovalNotAllowed: {custom: true, error: 'ApprovalNotAllowed'},
  };

  let deployer, owner, other, operatorRoleHolder;
  before(async function () {
    const accounts = await ethers.getSigners();
    [deployer, owner, other, operatorRoleHolder] = accounts;
  });

  const fixture = async function () {
    this.metadataResolver = await deployTokenMetadataResolverWithBaseURI();
    this.token = await deployContract('EDULand', name, symbol, this.metadataResolver);

    await this.token.grantRole(await this.token.OPERATOR_ROLE(), operatorRoleHolder.address);
    await this.token.connect(operatorRoleHolder).mint(owner.address, nft1);
    await this.token.connect(operatorRoleHolder).mint(owner.address, nft2);
    await this.token.connect(operatorRoleHolder).mint(owner.address, nft3);

    this.receiver721 = await deployContract('ERC721ReceiverMock', true, await this.token.getAddress());
    this.refusingReceiver721 = await deployContract('ERC721ReceiverMock', false, await this.token.getAddress());
    this.wrongTokenReceiver721 = await deployContract('ERC721ReceiverMock', true, ethers.ZeroAddress);
    this.nftBalance = await this.token.balanceOf(owner.address);
  };

  beforeEach(async function () {
    await loadFixture(fixture, this);
  });

  context('name()', function () {
    it('returns the correct value', async function () {
      expect(await this.token.name()).to.equal(name);
    });
  });

  context('symbol()', function () {
    it('returns the correct value', async function () {
      expect(await this.token.symbol()).to.equal(symbol);
    });
  });

  context('tokenURI(uint256)', function () {
    it('does not revert when called on an existing token', async function () {
      await this.token.tokenURI(nft1);
    });

    it('reverts if the token does not exist', async function () {
      await expectRevert(this.token.tokenURI(unknownNFT), this.token, errors.NonExistingToken, {
        tokenId: unknownNFT,
      });
    });
  });

  context('metadataResolver()', function () {
    it('returns metadata resolver address', async function () {
      expect(await this.token.metadataResolver()).to.equal(await this.metadataResolver.getAddress());
    });
  });

  context('approve(address,address)', function () {
    it('always reverts', async function () {
      await expectRevert(this.token.connect(owner).approve(other.address, nft1), this.token, errors.ApprovalNotAllowed);
    });
  });

  context('setApprovalForAll(address,bool)', function () {
    it('reverts when setting approval', async function () {
      await expectRevert(this.token.connect(owner).setApprovalForAll(other.address, true), this.token, errors.ApprovalNotAllowed);
    });

    it('reverts when un-setting approval', async function () {
      await expectRevert(this.token.connect(owner).setApprovalForAll(other.address, false), this.token, errors.ApprovalNotAllowed);
    });
  });

  context('minting', function () {
    const nftToMint = 10;
    const nftToMint2 = 11;
    const revertsOnPreconditions = function (mintFunction, data) {
      context('Pre-conditions', function () {
        it('reverts if minted to the zero address', async function () {
          this.sender = operatorRoleHolder;
          this.to = ethers.ZeroAddress;
          await expectRevert(mintFunction.call(this, nftToMint, data), this.token, errors.MintToAddressZero);
        });

        it('reverts if the token already exists', async function () {
          this.sender = operatorRoleHolder;
          this.to = owner.address;
          await mintFunction.call(this, nftToMint, data);
          await expectRevert(mintFunction.call(this, nftToMint, data), this.token, errors.ExistingToken, {
            tokenId: nftToMint,
          });
        });

        it('reverts if sent by non-operator', async function () {
          this.sender = owner;
          this.to = owner.address;
          await expectRevert(mintFunction.call(this, nftToMint, data), this.token, errors.NotOperator, {
            role: await this.token.OPERATOR_ROLE(),
            account: owner.address,
          });
        });

        if (data !== undefined) {
          it('reverts when sent to a non-receiver contract', async function () {
            this.sender = operatorRoleHolder;
            this.to = await this.token.getAddress();
            await expect(mintFunction.call(this, nftToMint, data)).to.be.reverted;
          });

          it('reverts when sent to an ERC721Receiver which reverts', async function () {
            this.sender = operatorRoleHolder;
            this.to = await this.wrongTokenReceiver721.getAddress();
            await expect(mintFunction.call(this, nftToMint, data)).to.be.reverted;
          });

          it('reverts when sent to an ERC721Receiver which rejects the transfer', async function () {
            this.sender = operatorRoleHolder;
            this.to = await this.refusingReceiver721.getAddress();
            await expectRevert(mintFunction.call(this, nftToMint, data), this.token, errors.SafeTransferRejected, {
              recipient: this.to,
              tokenId: nftToMint,
            });
          });
        }
      });
    };

    const mintsByOperatorRoleHolder = function (mintFunction, ids, data) {
      const mintWasSuccessful = function (tokenIds, data, isERC721Receiver) {
        const ids = Array.isArray(tokenIds) ? tokenIds : [tokenIds];
        it('gives the ownership of the token(s) to the given address', async function () {
          for (const id of ids) {
            expect(await this.token.ownerOf(id)).to.equal(this.to);
          }
        });

        it('has an empty approval for the token(s)', async function () {
          for (const id of ids) {
            expect(await this.token.ownerOf(id)).to.equal(this.to);
          }
        });

        it('emits Transfer event(s)', async function () {
          for (const id of ids) {
            await expect(this.receipt).to.emit(this.token, 'Transfer').withArgs(ethers.ZeroAddress, this.to, id);
          }
        });

        it('adjusts recipient balance', async function () {
          const quantity = Array.isArray(tokenIds) ? tokenIds.length : 1;
          const preBalance = this.preBalance === undefined ? 0 : Number(this.preBalance);
          expect(await this.token.balanceOf(this.to)).to.equal(quantity + preBalance);
        });

        if (data !== undefined && isERC721Receiver) {
          it('calls onERC721Received', async function () {
            await expect(this.receipt)
              .to.emit(this.receiver721, 'ERC721Received')
              .withArgs(operatorRoleHolder.address, ethers.ZeroAddress, tokenIds, data);
          });
        }
      };

      context('when sent to a wallet', function () {
        this.beforeEach(async function () {
          this.sender = operatorRoleHolder;
          this.to = owner.address;
          this.preBalance = this.nftBalance;
          this.receipt = await mintFunction.call(this, ids, data);
        });
        mintWasSuccessful(ids, data, false);
      });

      context('when sent to an ERC721Receiver contract', function () {
        this.beforeEach(async function () {
          this.sender = operatorRoleHolder;
          this.to = await this.receiver721.getAddress();
          this.receipt = await mintFunction.call(this, ids, data);
        });
        mintWasSuccessful(ids, data, true);
      });
    };

    context('mint(address,uint256)', function () {
      const mintFn = async function (tokenId, _data) {
        return this.token.connect(this.sender).mint(this.to, tokenId);
      };
      const data = undefined;
      revertsOnPreconditions(mintFn, data);
      mintsByOperatorRoleHolder(mintFn, nftToMint, data);
    });

    context('batchMint(address,uint256[])', function () {
      const mintFn = async function (tokenIds, _data) {
        const ids = Array.isArray(tokenIds) ? tokenIds : [tokenIds];
        return this.token.connect(this.sender).batchMint(this.to, ids);
      };
      const data = undefined;
      revertsOnPreconditions(mintFn, data);

      context('with an empty list of tokens', function () {
        mintsByOperatorRoleHolder(mintFn, [], data);
      });

      context('with a single token', function () {
        mintsByOperatorRoleHolder(mintFn, [nftToMint], data);
      });

      context('with a list of tokens from the same collection', function () {
        mintsByOperatorRoleHolder(mintFn, [nftToMint, nftToMint2], data);
      });
    });

    context('safeMint(address,uint256,bytes)', function () {
      const mintFn = async function (tokenId, data) {
        return this.token.connect(this.sender).safeMint(this.to, tokenId, data);
      };
      const data = '0x42';
      revertsOnPreconditions(mintFn, data);
      mintsByOperatorRoleHolder(mintFn, nftToMint, data);
    });
  });

  context('burning', function () {
    const revertsOnPreconditions = function (burnFunction) {
      context('Pre-condition', function () {
        it('reverts if the token does not exist', async function () {
          this.sender = operatorRoleHolder;
          this.from = owner.address;
          await expectRevert(burnFunction.call(this, unknownNFT), this.token, errors.NonExistingToken, {
            tokenId: unknownNFT,
          });
        });

        it('reverts if `from` is not the token owner', async function () {
          this.sender = operatorRoleHolder;
          this.from = other.address;
          await expectRevert(burnFunction.call(this, nft1), this.token, errors.NonOwnedToken, {
            account: other.address,
            tokenId: nft1,
          });
        });

        context('when not called by an operator role holder', function () {
          it('reverts if called by the token owner', async function () {
            this.sender = owner;
            this.from = other.address;
            await expectRevert(burnFunction.call(this, nft1), this.token, errors.NotOperator, {
              role: this.token.OPERATOR_ROLE(),
              account: owner,
            });
          });
        });
      });
    };

    const burnsByOperatorRoleHolder = function (burnFunction, ids) {
      context('when called by an operator role holder', function () {
        const tokenIds = Array.isArray(ids) ? ids : [ids];
        beforeEach(async function () {
          this.sender = operatorRoleHolder;
          this.from = owner.address;
          this.receipt = await burnFunction.call(this, ids);
        });

        it('clears the ownership of the token(s)', async function () {
          for (const id of tokenIds) {
            await expectRevert(this.token.ownerOf(id), this.token, errors.NonExistingToken, {tokenId: id});
          }
        });

        it('decreases the sender balance', async function () {
          expect(await this.token.balanceOf(owner.address)).to.equal(this.nftBalance - BigInt(tokenIds.length));
        });

        it('emits Transfer event(s)', async function () {
          for (const id of tokenIds) {
            await expect(this.receipt).to.emit(this.token, 'Transfer').withArgs(owner.address, ethers.ZeroAddress, id);
          }
        });

        context('can be minted again', function () {
          if (tokenIds.length > 0) {
            it('can be minted again, using mint(address,uint256)', async function () {
              for (const id of tokenIds) {
                await this.token.connect(operatorRoleHolder).mint(owner.address, id);
              }
            });

            it('can be minted again, using batchMint(address,uint256[])', async function () {
              await this.token.connect(operatorRoleHolder).batchMint(owner.address, tokenIds);
            });

            it('can be minted again, using safeMint(address,uint256,bytes)', async function () {
              for (const id of tokenIds) {
                await this.token.connect(operatorRoleHolder).safeMint(owner.address, id, '0x');
              }
            });
          }
        });
      });
    };

    context('burnFrom(address,uint256)', function () {
      const burnFn = async function (tokenId) {
        return this.token.connect(this.sender).burnFrom(this.from, tokenId);
      };
      revertsOnPreconditions(burnFn);
      burnsByOperatorRoleHolder(burnFn, nft1);
    });

    context('batchBurnFrom(address,uint256[])', function () {
      const burnFn = async function (tokenIds) {
        const ids = Array.isArray(tokenIds) ? tokenIds : [tokenIds];
        return this.token.connect(this.sender).batchBurnFrom(this.from, ids);
      };
      revertsOnPreconditions(burnFn);

      context('with an empty list of tokens', function () {
        burnsByOperatorRoleHolder(burnFn, []);
      });

      context('with a single token', function () {
        burnsByOperatorRoleHolder(burnFn, [nft1]);
      });

      context('with a list of tokens from the same collection', function () {
        burnsByOperatorRoleHolder(burnFn, [nft1, nft2]);
      });
    });
  });

  context('single transfer', function () {
    const revertsOnPreconditions = function (transferFunction, data) {
      context('Pre-conditions', function () {
        it('reverts if transferred to the zero address', async function () {
          this.sender = operatorRoleHolder;
          this.from = owner.address;
          this.to = ethers.ZeroAddress;
          await expectRevert(transferFunction.call(this, nft1, data), this.token, errors.TransferToAddressZero);
        });

        it('reverts if the token does not exist', async function () {
          this.sender = operatorRoleHolder;
          this.from = owner.address;
          this.to = other.address;
          await expectRevert(transferFunction.call(this, unknownNFT, data), this.token, errors.NonExistingToken, {
            tokenId: unknownNFT,
          });
        });

        it('reverts if `from` is not the token owner', async function () {
          this.sender = operatorRoleHolder;
          this.from = other.address;
          this.to = other.address;
          await expectRevert(transferFunction.call(this, nft1, data), this.token, errors.NonOwnedToken, {
            account: other.address,
            tokenId: nft1,
          });
        });

        context('when not called by an operator role holder', function () {
          it('reverts if called by the token owner', async function () {
            this.sender = owner;
            this.from = other.address;
            this.to = other.address;
            await expectRevert(transferFunction.call(this, nft1, data), this.token, errors.NotOperator, {
              role: this.token.OPERATOR_ROLE(),
              account: owner.address,
            });
          });
        });

        if (data !== undefined) {
          it('reverts if sent to a non-receiver contract', async function () {
            this.sender = operatorRoleHolder;
            this.from = owner.address;
            this.to = await this.token.getAddress();
            await expect(transferFunction.call(this, nft1, data)).to.be.reverted;
          });
          it('reverts if sent to an ERC721Receiver which reverts', async function () {
            this.sender = operatorRoleHolder;
            this.from = owner.address;
            this.to = await this.wrongTokenReceiver721.getAddress();
            await expect(transferFunction.call(this, nft1, data)).to.be.reverted;
          });
          it('reverts if sent to an ERC721Receiver which rejects the transfer', async function () {
            this.sender = operatorRoleHolder;
            this.from = owner.address;
            this.to = await this.refusingReceiver721.getAddress();
            await expectRevert(transferFunction.call(this, nft1, data), this.token, errors.SafeTransferRejected, {
              recipient: this.to,
              tokenId: nft1,
            });
          });
        }
      });
    };

    const transfersByOperatorRoleHolder = function (transferFunction, tokenId, data, isERC721Receiver, selfTransfer) {
      context('when called by an operator role holder', function () {
        beforeEach(async function () {
          this.sender = operatorRoleHolder;
          this.receipt = await transferFunction.call(this, tokenId, data);
        });
        if (selfTransfer) {
          it('does not affect the token ownership', async function () {
            expect(await this.token.ownerOf(tokenId)).to.equal(this.from);
          });
        } else {
          it('gives the token ownership to the recipient', async function () {
            expect(await this.token.ownerOf(tokenId)).to.equal(this.to);
          });
        }

        it('emits a Transfer event', async function () {
          await expect(this.receipt).to.emit(this.token, 'Transfer').withArgs(this.from, this.to, tokenId);
        });

        if (selfTransfer) {
          it('does not affect the owner balance', async function () {
            expect(await this.token.balanceOf(this.from)).to.equal(this.nftBalance);
          });
        } else {
          it('decreases the owner balance', async function () {
            expect(await this.token.balanceOf(this.from)).to.equal(this.nftBalance - 1n);
          });

          it('increases the recipients balance', async function () {
            expect(await this.token.balanceOf(this.to)).to.equal(1);
          });
        }

        if (data !== undefined && isERC721Receiver) {
          it('calls on ERC721Received', async function () {
            await expect(this.receipt).to.emit(this.receiver721, 'ERC721Received').withArgs(this.sender.address, this.from, tokenId, data);
          });
        }
      });
    };

    const transfer = function (transferFunction, tokenId, data) {
      context('when sent to another wallet', function () {
        beforeEach(async function () {
          this.from = owner.address;
          this.to = other.address;
        });
        transfersByOperatorRoleHolder(transferFunction, tokenId, data, false);
      });

      context('when sent to the same owner', function () {
        this.beforeEach(async function () {
          this.from = owner.address;
          this.to = owner.address;
        });
        const selfTransfer = true;
        transfersByOperatorRoleHolder(transferFunction, tokenId, data, false, selfTransfer);
      });

      context('when sent to an ERC721Receiver contract', function () {
        this.beforeEach(async function () {
          this.from = owner.address;
          this.to = await this.receiver721.getAddress();
        });
        transfersByOperatorRoleHolder(transferFunction, tokenId, data, true);
      });
    };

    context('transferFrom(address,address,uint256)', function () {
      const transferFn = async function (tokenId, _data) {
        return this.token.connect(this.sender).transferFrom(this.from, this.to, tokenId);
      };
      const data = undefined;
      revertsOnPreconditions(transferFn, data);
      transfer(transferFn, nft1, data);
    });

    context('safeTransferFrom(address,address,uint256)', function () {
      const transferFn = async function (tokenId, _data) {
        return this.token.connect(this.sender)['safeTransferFrom(address,address,uint256)'](this.from, this.to, tokenId);
      };
      const data = '0x';
      revertsOnPreconditions(transferFn, data);
      transfer(transferFn, nft1, data);
    });

    context('safeTransferFrom(address,address,uint256,bytes)', function () {
      const transferFn = async function (tokenId, data) {
        return this.token.connect(this.sender)['safeTransferFrom(address,address,uint256,bytes)'](this.from, this.to, tokenId, data);
      };
      const data = '0x42';
      revertsOnPreconditions(transferFn, data);
      transfer(transferFn, nft1, data);
    });
  });

  context('batchTransferFrom(address,address,uint256[])', function () {
    context('Pre-conditions', function () {
      it('reverts if transferred to the zero address', async function () {
        await expectRevert(
          this.token.connect(operatorRoleHolder).batchTransferFrom(owner.address, ethers.ZeroAddress, [nft1]),
          this.token,
          errors.TransferToAddressZero
        );
      });

      it('reverts if the token does not exist', async function () {
        await expectRevert(
          this.token.connect(operatorRoleHolder).batchTransferFrom(owner.address, other.address, [unknownNFT]),
          this.token,
          errors.NonExistingToken,
          {
            tokenId: unknownNFT,
          }
        );
      });

      it('reverts if `from` is not the token owner', async function () {
        await expectRevert(
          this.token.connect(operatorRoleHolder).batchTransferFrom(other.address, other.address, [nft1]),
          this.token,
          errors.NonOwnedToken,
          {
            account: other.address,
            tokenId: nft1,
          }
        );
      });

      context('when not called by an operator role holder', function () {
        it('reverts if called by the token owner', async function () {
          await expectRevert(this.token.connect(owner).batchTransferFrom(owner.address, other.address, [nft1]), this.token, errors.NotOperator, {
            role: this.token.OPERATOR_ROLE(),
            account: owner.address,
          });
        });
      });
    });

    const transfersByOperatorRoleHolder = function (tokenIds, selfTransfer = false) {
      context('when called by an operator role holder', function () {
        beforeEach(async function () {
          this.receipt = await this.token.connect(operatorRoleHolder).batchTransferFrom(this.from, this.to, tokenIds);
        });

        if (selfTransfer) {
          it('does not affect the token(s) ownership', async function () {
            for (const tokenId of tokenIds) {
              expect(await this.token.ownerOf(tokenId)).to.equal(this.from);
            }
          });
        } else {
          it('gives the token(s) ownership to the recipient', async function () {
            for (const tokenId of tokenIds) {
              expect(await this.token.ownerOf(tokenId)).to.equal(this.to);
            }
          });
        }

        it('emits Transfer event(s)', async function () {
          for (const tokenId of tokenIds) {
            await expect(this.receipt).to.emit(this.token, 'Transfer').withArgs(this.from, this.to, tokenId);
          }
        });

        if (selfTransfer) {
          it('does not affect the owner balance', async function () {
            expect(await this.token.balanceOf(this.from)).to.equal(this.nftBalance);
          });
        } else {
          it('decreases the owner balance', async function () {
            expect(await this.token.balanceOf(this.from)).to.equal(this.nftBalance - BigInt(tokenIds.length));
          });

          it('increases the recipients balance', async function () {
            expect(await this.token.balanceOf(this.to)).to.equal(BigInt(tokenIds.length));
          });
        }
      });
    };

    const transfer = function (ids) {
      context('when sent to another wallet', function () {
        beforeEach(async function () {
          this.from = owner.address;
          this.to = other.address;
        });
        transfersByOperatorRoleHolder(ids);
      });

      context('when sent to the same owner', function () {
        this.beforeEach(async function () {
          this.from = owner.address;
          this.to = owner.address;
        });
        transfersByOperatorRoleHolder(ids, true);
      });
    };

    context('with an empty list of token', function () {
      transfer([]);
    });
    context('with a single token', function () {
      transfer([nft1]);
    });
    context('with a list of tokens', function () {
      transfer([nft1, nft2]);
    });
  });

  context('balanceOf(address)', function () {
    it('reverts if querying the zero address', async function () {
      await expectRevert(this.token.balanceOf(ethers.ZeroAddress), this.token, errors.BalanceOfAddressZero);
    });

    it('returns the amount of tokens owned', async function () {
      expect(await this.token.balanceOf(other.address)).to.equal(0);
      expect(await this.token.balanceOf(owner.address)).to.equal(3);
    });
  });

  context('ownerOf(uint256)', function () {
    it('reverts if the token does not exist', async function () {
      await expectRevert(this.token.ownerOf(unknownNFT), this.token, errors.NonExistingToken, {
        tokenId: unknownNFT,
      });
    });

    it('returns the owner of the token', async function () {
      expect(await this.token.ownerOf(nft1)).to.equal(owner.address);
    });
  });

  context('getApproved(uint256)', function () {
    it('reverts if the token does not exist', async function () {
      await expectRevert(this.token.getApproved(unknownNFT), this.token, errors.NonExistingToken, {
        tokenId: unknownNFT,
      });
    });

    it('returns the zero address', async function () {
      await expectRevert(this.token.connect(owner).approve(other.address, nft1), this.token, errors.ApprovalNotAllowed);
      expect(await this.token.getApproved(nft1)).to.equal(ethers.ZeroAddress);
    });
  });

  context('isApprovedForAll(address,address)', function () {
    it('returns false', async function () {
      await expectRevert(this.token.connect(owner).setApprovalForAll(other.address, true), this.token, errors.ApprovalNotAllowed);
      expect(await this.token.isApprovedForAll(owner.address, other.address)).to.equal(false);
    });
  });

  supportsInterfaces([
    '@animoca/ethereum-contracts/contracts/introspection/interfaces/IERC165.sol:IERC165',
    '@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721.sol:IERC721',
    'IERC721BatchTransfer',
    'IERC721Burnable',
    'IERC721Mintable',
    'IERC721Metadata',
  ]);
});
