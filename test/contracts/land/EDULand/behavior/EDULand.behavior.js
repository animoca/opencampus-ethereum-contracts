const {ethers} = require('hardhat');
const {expect} = require('chai');
const {expectRevert} = require('@animoca/ethereum-contract-helpers/src/test/revert');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {supportsInterfaces} = require('@animoca/ethereum-contracts/test/contracts/introspection/behaviors/SupportsInterface.behavior');

function behavesLikeERC721({deploy, mint, errors}, operatorFilterRegistryAddress = null) {
  describe('like an ERC721', function () {
    let accounts, deployer, owner, other, operatorRoleHolder;

    before(async function () {
      accounts = await ethers.getSigners();
      [deployer, owner, other, operatorRoleHolder] = accounts;
    });

    const nft1 = 1;
    const nft2 = 2;
    const nft3 = 3;
    const unknownNFT = 1000;

    const fixture = async function () {
      this.token = await deploy(deployer, operatorRoleHolder);
      await mint(this.token, owner.address, nft1, 1, operatorRoleHolder);
      await mint(this.token, owner.address, nft2, 1, operatorRoleHolder);
      await mint(this.token, owner.address, nft3, 1, operatorRoleHolder);

      this.receiver721 = await deployContract('ERC721ReceiverMock', true, await this.token.getAddress());
      this.refusingReceiver721 = await deployContract('ERC721ReceiverMock', false, await this.token.getAddress());
      this.wrongTokenReceiver721 = await deployContract('ERC721ReceiverMock', true, ethers.ZeroAddress);
      this.nftBalance = await this.token.balanceOf(owner.address);
      if (operatorFilterRegistryAddress !== null) {
        await this.token.updateOperatorFilterRegistry(operatorFilterRegistryAddress);
      }
    };

    beforeEach(async function () {
      await loadFixture(fixture, this);
    });

    describe('balanceOf(address)', function () {
      it('reverts if querying the zero address', async function () {
        await expectRevert(this.token.balanceOf(ethers.ZeroAddress), this.token, errors.BalanceOfAddressZero);
      });

      it('returns the amount of tokens owned', async function () {
        expect(await this.token.balanceOf(other.address)).to.equal(0);
        expect(await this.token.balanceOf(owner.address)).to.equal(3);
      });
    });

    describe('ownerOf(uint256)', function () {
      it('reverts if the token does not exist', async function () {
        await expectRevert(this.token.ownerOf(unknownNFT), this.token, errors.NonExistingToken, {
          tokenId: unknownNFT,
        });
      });

      it('returns the owner of the token', async function () {
        expect(await this.token.ownerOf(nft1)).to.equal(owner.address);
      });
    });

    const revertsOnPreconditions = function (transferFunction, data) {
      describe('Pre-conditions', function () {
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

    const transferWasSuccessful = function (tokenId, data, isERC721Receiver, selfTransfer) {
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
    };

    const transfersByOperatorRoleHolder = function (transferFunction, tokenId, data, isERC721Receiver, selfTransfer) {
      context('when called by an operator role holder', function () {
        beforeEach(async function () {
          this.sender = operatorRoleHolder;
          this.receipt = await transferFunction.call(this, tokenId, data);
        });
        transferWasSuccessful(tokenId, data, isERC721Receiver, selfTransfer);
      });
    };

    const transfersByRecipient = function (transferFunction, tokenId, data) {
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

    describe('transferFrom(address,address,uint256)', function () {
      const transferFn = async function (tokenId, _data) {
        return this.token.connect(this.sender).transferFrom(this.from, this.to, tokenId);
      };
      const data = undefined;
      revertsOnPreconditions(transferFn, data);
      transfersByRecipient(transferFn, nft1, data);
    });

    describe('safeTransferFrom(address,address,uint256)', function () {
      const transferFn = async function (tokenId, _data) {
        return this.token.connect(this.sender)['safeTransferFrom(address,address,uint256)'](this.from, this.to, tokenId);
      };
      const data = '0x';
      revertsOnPreconditions(transferFn, data);
      transfersByRecipient(transferFn, nft1, data);
    });

    describe('safeTransferFrom(address,address,uint256,bytes)', function () {
      const transferFn = async function (tokenId, data) {
        return this.token.connect(this.sender)['safeTransferFrom(address,address,uint256,bytes)'](this.from, this.to, tokenId, data);
      };
      const data = '0x42';
      revertsOnPreconditions(transferFn, data);
      transfersByRecipient(transferFn, nft1, data);
    });

    describe('approve(address,address)', function () {
      it('always reverts', async function () {
        await expectRevert(this.token.connect(owner).approve(other.address, nft1), this.token, errors.ApprovalNotAllowed);
      });
    });

    describe('getApproved(uint256)', function () {
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

    describe('setApprovalForAll(address,bool)', function () {
      context('always reverts', function () {
        it('reverts when setting approval', async function () {
          await expectRevert(this.token.connect(owner).setApprovalForAll(other.address, true), this.token, errors.ApprovalNotAllowed);
        });

        it('reverts when un-setting approval', async function () {
          await expectRevert(this.token.connect(owner).setApprovalForAll(other.address, false), this.token, errors.ApprovalNotAllowed);
        });
      });
    });

    describe('isApprovedForAll(address,address)', function () {
      it('returns false', async function () {
        await expectRevert(this.token.connect(owner).setApprovalForAll(other.address, true), this.token, errors.ApprovalNotAllowed);
        expect(await this.token.isApprovedForAll(owner.address, other.address)).to.equal(false);
      });
    });

    supportsInterfaces([
      '@animoca/ethereum-contracts/contracts/introspection/interfaces/IERC165.sol:IERC165',
      '@animoca/ethereum-contracts/contracts/token/ERC721/interfaces/IERC721.sol:IERC721',
    ]);
  });
}

module.exports = {
  behavesLikeERC721,
};
