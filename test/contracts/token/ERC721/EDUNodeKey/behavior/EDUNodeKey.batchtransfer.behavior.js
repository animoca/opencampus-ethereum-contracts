const {ethers} = require('hardhat');
const {expect} = require('chai');
const {expectRevert} = require('@animoca/ethereum-contract-helpers/src/test/revert');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {supportsInterfaces} = require('@animoca/ethereum-contracts/test/contracts/introspection/behaviors/SupportsInterface.behavior');

function behavesLikeBatchTransfer({deploy, mint, interfaces, errors, methods}) {
  const {'batchTransferFrom(address,address,uint256[])': batchTransferFrom_ERC721} = methods || {};

  describe('like an BatchTransfer', function () {
    let accounts, deployer, owner, approved, approvedAll, other, operatorRoleHolder;

    before(async function () {
      accounts = await ethers.getSigners();
      [deployer, owner, approved, approvedAll, other, operatorRoleHolder] = accounts;
    });

    const nft1 = 1;
    const nft2 = 2;
    const nft3 = 3;
    const unknownNFT = 1000;

    const fixture = async function () {
      this.token = await deploy(deployer);
      await mint(this.token, owner.address, nft1, 1, deployer);
      await mint(this.token, owner.address, nft2, 1, deployer);
      await mint(this.token, owner.address, nft3, 1, deployer);

      // NOTE: only the operator role holder can transfer the tokens
      await this.token.grantRole(this.token.OPERATOR_ROLE(), operatorRoleHolder.address);

      // NOTE: approve should have no effect on the batchTransferFrom
      await this.token.connect(owner).approve(approved.address, nft1);
      await this.token.connect(owner).approve(approved.address, nft2);
      await this.token.connect(owner).setApprovalForAll(approvedAll.address, true);

      this.nftBalance = await this.token.balanceOf(owner.address);
    };

    beforeEach(async function () {
      await loadFixture(fixture, this);
    });

    if (batchTransferFrom_ERC721 !== undefined) {
      const transferWasSuccessful = function (tokenIds, selfTransfer) {
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

        it('clears the approval for the token(s)', async function () {
          for (const tokenId of tokenIds) {
            expect(await this.token.getApproved(tokenId)).to.equal(ethers.ZeroAddress);
          }
        });

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
      };

      const transfersByOperatorRoleHolder = function (tokenIds, selfTransfer = false) {
        context('when called by an operator role holder', function () {
          beforeEach(async function () {
            this.receipt = await batchTransferFrom_ERC721(this.token, this.from, this.to, tokenIds, operatorRoleHolder);
          });
          transferWasSuccessful(tokenIds, selfTransfer);
        });
      };

      const transfersByRecipient = function (ids) {
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

      describe('batchTransferFrom(address,address,uint256[])', function () {
        describe('Pre-conditions', function () {
          it('reverts if transferred to the zero address', async function () {
            await expectRevert(
              batchTransferFrom_ERC721(this.token, owner.address, ethers.ZeroAddress, [nft1], operatorRoleHolder),
              this.token,
              errors.TransferToAddressZero
            );
          });

          it('reverts if the token does not exist', async function () {
            await expectRevert(
              batchTransferFrom_ERC721(this.token, owner.address, other.address, [unknownNFT], operatorRoleHolder),
              this.token,
              errors.NonExistingToken,
              {
                tokenId: unknownNFT,
              }
            );
          });

          it('reverts if `from` is not the token owner', async function () {
            await expectRevert(
              batchTransferFrom_ERC721(this.token, other.address, other.address, [nft1], operatorRoleHolder),
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
              await expectRevert(batchTransferFrom_ERC721(this.token, owner.address, other.address, [nft1], owner), this.token, errors.NotOperator, {
                role: this.token.OPERATOR_ROLE(),
                account: owner.address,
              });
            });

            it('reverts if called by a wallet with single token approval', async function () {
              await expectRevert(
                batchTransferFrom_ERC721(this.token, owner.address, other.address, [nft1], approved),
                this.token,
                errors.NotOperator,
                {
                  role: this.token.OPERATOR_ROLE(),
                  account: approved.address,
                }
              );
            });

            it('reverts if called by a wallet all tokens approval', async function () {
              await expectRevert(
                batchTransferFrom_ERC721(this.token, owner.address, other.address, [nft1], approvedAll),
                this.token,
                errors.NotOperator,
                {
                  role: this.token.OPERATOR_ROLE(),
                  account: approvedAll.address,
                }
              );
            });
          });
        });

        context('with an empty list of token', function () {
          transfersByRecipient([]);
        });
        context('with a single token', function () {
          transfersByRecipient([nft1]);
        });
        context('with a list of tokens', function () {
          transfersByRecipient([nft1, nft2]);
        });
      });
    }

    if (interfaces && interfaces.ERC721BatchTransfer) {
      supportsInterfaces(['IERC721BatchTransfer']);
    }
  });
}

module.exports = {
  behavesLikeBatchTransfer,
};
