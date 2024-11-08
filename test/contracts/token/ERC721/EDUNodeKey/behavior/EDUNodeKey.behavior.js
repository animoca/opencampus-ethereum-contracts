const {ethers} = require('hardhat');
const {expect} = require('chai');
const {expectRevert} = require('@animoca/ethereum-contract-helpers/src/test/revert');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {supportsInterfaces} = require('@animoca/ethereum-contracts/test/contracts/introspection/behaviors/SupportsInterface.behavior');

function behavesLikeNonTransferableERC721({deploy, mint, errors}, operatorFilterRegistryAddress = null) {
  describe('like an non-transferable ERC721', function () {
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

      await this.token.grantRole(this.token.OPERATOR_ROLE(), operatorRoleHolder.address);

      await this.token.connect(owner).approve(approved.address, nft1);
      await this.token.connect(owner).approve(approved.address, nft2);
      await this.token.connect(owner).setApprovalForAll(approvedAll.address, true);

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

    const revertsOnTransfer = function (transferFunction, data) {
      describe('reverts any transfer attempt, regardless of the sender', function () {
        it('reverts if called by the token owner operator role holder', async function () {
          this.sender = operatorRoleHolder;
          this.from = owner.address;
          this.to = other.address;
          await expectRevert(transferFunction.call(this, nft1, data), this.token, errors.NotTransferable);
        });

        it('reverts if called by the token owner', async function () {
          this.sender = owner;
          this.from = other.address;
          this.to = other.address;
          await expectRevert(transferFunction.call(this, nft1, data), this.token, errors.NotTransferable);
        });

        it('reverts if called by a wallet with single token approval', async function () {
          this.sender = approved;
          this.from = other.address;
          this.to = other.address;
          await expectRevert(transferFunction.call(this, nft1, data), this.token, errors.NotTransferable);
        });

        it('reverts if called by a wallet all tokens approval', async function () {
          this.sender = approvedAll;
          this.from = other.address;
          this.to = other.address;
          await expectRevert(transferFunction.call(this, nft1, data), this.token, errors.NotTransferable);
        });
      });
    };

    describe('transferFrom(address,address,uint256)', function () {
      const transferFn = async function (tokenId, _data) {
        return this.token.connect(this.sender).transferFrom(this.from, this.to, tokenId);
      };
      const data = undefined;
      revertsOnTransfer(transferFn, data);
    });

    describe('safeTransferFrom(address,address,uint256)', function () {
      const transferFn = async function (tokenId, _data) {
        return this.token.connect(this.sender)['safeTransferFrom(address,address,uint256)'](this.from, this.to, tokenId);
      };
      const data = '0x';
      revertsOnTransfer(transferFn, data);
    });

    describe('safeTransferFrom(address,address,uint256,bytes)', function () {
      const transferFn = async function (tokenId, data) {
        return this.token.connect(this.sender)['safeTransferFrom(address,address,uint256,bytes)'](this.from, this.to, tokenId, data);
      };
      const data = '0x42';
      revertsOnTransfer(transferFn, data);
    });

    describe('approve(address,address)', function () {
      it('reverts if the token does not exist', async function () {
        await expectRevert(this.token.connect(owner).approve(approved.address, unknownNFT), this.token, errors.NonExistingToken, {
          tokenId: unknownNFT,
        });
      });

      it('reverts in case of self-approval', async function () {
        await expectRevert(this.token.connect(owner).approve(owner.address, nft1), this.token, errors.SelfApproval, {
          account: owner.address,
        });
      });

      it('reverts if the sender does not own the token and is not an operator (approvedAll) for the owner', async function () {
        await expectRevert(this.token.connect(other).approve(approved.address, nft1), this.token, errors.NonApprovedForApproval, {
          sender: other.address,
          owner: owner.address,
          tokenId: nft1,
        });
      });

      it('reverts if the sender has an approval for the token', async function () {
        await expectRevert(this.token.connect(approved).approve(other.address, nft1), this.token, errors.NonApprovedForApproval, {
          sender: approved.address,
          owner: owner.address,
          tokenId: nft1,
        });
      });

      function approvalWasSuccessful(tokenId) {
        it('sets the token approval', async function () {
          expect(await this.token.getApproved(tokenId)).to.equal(this.approvedAddress);
        });

        it('emits an Approval event', async function () {
          await expect(this.receipt).to.emit(this.token, 'Approval').withArgs(owner.address, this.approvedAddress, tokenId);
        });
      }

      function setApprovalBySender(tokenId) {
        context('when sent by the token owner', function () {
          beforeEach(async function () {
            this.receipt = await this.token.connect(owner).approve(this.approvedAddress, tokenId);
          });
          approvalWasSuccessful(tokenId);
        });

        context('when sent by an operator(approvedAll) for the token owner', function () {
          beforeEach(async function () {
            this.receipt = await this.token.connect(approvedAll).approve(this.approvedAddress, tokenId);
          });
          approvalWasSuccessful(tokenId);
        });
      }

      context('when setting an approval', function () {
        context('when there was no prior approval', function () {
          beforeEach(async function () {
            this.approvedAddress = approved.address;
          });
          setApprovalBySender(nft3);
        });

        context('when there was a prior approval to the same address', function () {
          beforeEach(async function () {
            this.approvedAddress = approved.address;
          });
          setApprovalBySender(nft1);
        });

        context('when there was a prior approval to a different address', function () {
          this.beforeEach(async function () {
            this.approvedAddress = other.address;
          });
          setApprovalBySender(nft1);
        });
      });

      context('when clearing an approval', function () {
        context('when there was no prior approval', function () {
          beforeEach(async function () {
            this.approvedAddress = ethers.ZeroAddress;
          });
          setApprovalBySender(nft3);
        });
        context('when there was a prior approval', function () {
          beforeEach(async function () {
            this.approvedAddress = ethers.ZeroAddress;
          });
          setApprovalBySender(nft1);
        });
      });
    });

    describe('getApproved(uint256)', function () {
      it('reverts if the token does not exist', async function () {
        await expectRevert(this.token.getApproved(unknownNFT), this.token, errors.NonExistingToken, {
          tokenId: unknownNFT,
        });
      });

      it('returns the approved address if an approval was set', async function () {
        expect(await this.token.getApproved(nft1)).to.equal(approved.address);
      });

      it('returns the zero address if no approval was set', async function () {
        expect(await this.token.getApproved(nft3)).to.equal(ethers.ZeroAddress);
      });
    });

    describe('setApprovalForAll(address,bool)', function () {
      it('reverts in case of self-approval', async function () {
        await expectRevert(this.token.connect(owner).setApprovalForAll(owner.address, true), this.token, errors.SelfApprovalForAll, {
          account: owner.address,
        });
        await expectRevert(this.token.connect(owner).setApprovalForAll(owner.address, false), this.token, errors.SelfApprovalForAll, {
          account: owner.address,
        });
      });

      context('when setting an operator(approvedAll)', function () {
        beforeEach(async function () {
          this.receipt = await this.token.connect(owner).setApprovalForAll(other.address, true);
        });
        it('sets the operator(approvedAll)', async function () {
          expect(await this.token.isApprovedForAll(owner.address, other.address)).to.be.true;
        });
        it('emits an ApprovalForAll event', async function () {
          await expect(this.receipt).to.emit(this.token, 'ApprovalForAll').withArgs(owner.address, other.address, true);
        });
      });

      context('when unsetting an operator(approvedAll)', function () {
        beforeEach(async function () {
          this.receipt = await this.token.connect(owner).setApprovalForAll(approvedAll.address, false);
        });
        it('unsets the operator(approvedAll)', async function () {
          expect(await this.token.isApprovedForAll(owner.address, approvedAll.address)).to.be.false;
        });
        it('emits an ApprovalForAll event', async function () {
          await expect(this.receipt).to.emit(this.token, 'ApprovalForAll').withArgs(owner.address, approvedAll.address, false);
        });
      });
    });

    describe('isApprovedForAll(address,address)', function () {
      it('returns true for an operator(approvedAll)', async function () {
        expect(await this.token.isApprovedForAll(owner.address, approvedAll.address)).to.equal(true);
      });

      it('returns false for a non-operator', async function () {
        expect(await this.token.isApprovedForAll(owner.address, other.address)).to.equal(false);
      });
    });

    supportsInterfaces(['IERC165', 'IERC721']);
  });
}

module.exports = {
  behavesLikeNonTransferableERC721,
};
