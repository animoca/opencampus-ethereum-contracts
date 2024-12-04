const {ethers} = require('hardhat');
const {expect} = require('chai');
const {expectRevert} = require('@animoca/ethereum-contract-helpers/src/test/revert');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {supportsInterfaces} = require('@animoca/ethereum-contracts/test/contracts/introspection/behaviors/SupportsInterface.behavior');

function behavesLikeERC721Burnable({deploy, mint, errors, interfaces, methods}) {
  const {
    'burnFrom(address,uint256)': burnFrom,
    'batchBurnFrom(address,uint256[])': batchBurnFrom,
    'mint(address,uint256)': mint_ERC721,
    'safeMint(address,uint256,bytes)': safeMint_ERC721,
    'batchMint(address,uint256[])': batchMint_ERC721,
  } = methods || {};

  describe('like an ERC721 Burnable', function () {
    let accounts, deployer, owner, approved, approvedAll, other, operatorRoleHolder;
    let nft1 = 1;
    let nft2 = 2;
    let nft3 = 3;
    let nft4 = 4;
    let unknownNFT = 1000;

    before(async function () {
      accounts = await ethers.getSigners();
      [deployer, minter, owner, other, approved, approvedAll, operatorRoleHolder] = accounts;
    });

    const fixture = async function () {
      this.token = await deploy(deployer, operatorRoleHolder);
      await mint(this.token, owner.address, nft1, 1, operatorRoleHolder);
      await mint(this.token, owner.address, nft2, 1, operatorRoleHolder);
      await mint(this.token, owner.address, nft3, 1, operatorRoleHolder);
      await mint(this.token, owner.address, nft4, 1, operatorRoleHolder);

      // NOTE: approve/ setApprovalForAll should have no effect on the token burning
      await this.token.connect(owner).approve(approved.address, nft1);
      await this.token.connect(owner).approve(approved.address, nft2);
      await this.token.connect(owner).setApprovalForAll(approvedAll.address, true);

      this.nftBalance = await this.token.balanceOf(owner.address);
    };

    beforeEach(async function () {
      await loadFixture(fixture, this);
    });

    const revertsOnPreconditions = function (burnFunction) {
      describe('Pre-condition', function () {
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

          it('reverts if called by a wallet with single token approval', async function () {
            this.sender = approved;
            this.from = other.address;
            await expectRevert(burnFunction.call(this, nft1), this.token, errors.NotOperator, {
              role: this.token.OPERATOR_ROLE(),
              account: approved,
            });
          });

          it('reverts if called by a wallet all tokens approval', async function () {
            this.sender = approvedAll;
            this.from = other.address;
            await expectRevert(burnFunction.call(this, nft1), this.token, errors.NotOperator, {
              role: this.token.OPERATOR_ROLE(),
              account: approvedAll,
            });
          });
        });
      });
    };

    const canBeMintedAgain = function (ids) {
      ids = Array.isArray(ids) ? ids : [ids];

      if (mint_ERC721 !== undefined) {
        it('can be minted again, using mint(address,uint256)', async function () {
          for (const id of ids) {
            await mint_ERC721(this.token, owner.address, id, operatorRoleHolder);
          }
        });
      }

      if (batchMint_ERC721 !== undefined) {
        it('can be minted again, using batchMint(address,uint256[])', async function () {
          await batchMint_ERC721(this.token, owner.address, ids, operatorRoleHolder);
        });
      }

      if (safeMint_ERC721 !== undefined) {
        it('can be minted again, using safeMint(address,uint256,bytes)', async function () {
          for (const id of ids) {
            await safeMint_ERC721(this.token, owner.address, id, '0x', operatorRoleHolder);
          }
        });
      }

      if (interfaces && interfaces.ERC721Deliverable) {
        it('can be minted again, using deliver(address[],uint256[])', async function () {
          await this.token.deliver(
            ids.map(() => owner.address),
            ids
          );
        });
      }
    };

    const burnWasSuccessful = function (tokenIds) {
      const ids = Array.isArray(tokenIds) ? tokenIds : [tokenIds];

      it('clears the ownership of the token(s)', async function () {
        for (const id of ids) {
          await expectRevert(this.token.ownerOf(id), this.token, errors.NonExistingToken, {tokenId: id});
        }
      });

      it('clears the approval for the token(s)', async function () {
        for (const id of ids) {
          await expectRevert(this.token.getApproved(id), this.token, errors.NonExistingToken, {tokenId: id});
        }
      });

      it('decreases the sender balance', async function () {
        expect(await this.token.balanceOf(owner.address)).to.equal(this.nftBalance - BigInt(ids.length));
      });

      it('emits Transfer event(s)', async function () {
        for (const id of ids) {
          await expect(this.receipt).to.emit(this.token, 'Transfer').withArgs(owner.address, ethers.ZeroAddress, id);
        }
      });

      if (ids.length > 0) {
        canBeMintedAgain(ids);
      }
    };

    const burnsByOperatorRoleHolder = function (burnFunction, ids) {
      context('when called by an operator role holder', function () {
        beforeEach(async function () {
          this.sender = operatorRoleHolder;
          this.from = owner.address;
          this.receipt = await burnFunction.call(this, ids);
        });
        burnWasSuccessful(ids, owner);
      });
    };

    describe('burnFrom(address,uint256)', function () {
      const burnFn = async function (tokenId) {
        return burnFrom(this.token, this.from, tokenId, this.sender);
      };
      revertsOnPreconditions(burnFn);
      burnsByOperatorRoleHolder(burnFn, nft1);
    });

    describe('batchBurnFrom(address,uint256[])', function () {
      const burnFn = async function (tokenIds) {
        const ids = Array.isArray(tokenIds) ? tokenIds : [tokenIds];
        return batchBurnFrom(this.token, this.from, ids, this.sender);
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

    if (interfaces && interfaces.ERC721Burnable) {
      supportsInterfaces(['IERC721Burnable']);
    }
  });
}

module.exports = {
  behavesLikeERC721Burnable,
};
