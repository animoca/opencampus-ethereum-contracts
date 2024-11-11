const {ethers} = require('hardhat');
const {expect} = require('chai');
const {expectRevert} = require('@animoca/ethereum-contract-helpers/src/test/revert');
const {loadFixture} = require('@animoca/ethereum-contract-helpers/src/test/fixtures');
const {deployContract} = require('@animoca/ethereum-contract-helpers/src/test/deploy');
const {supportsInterfaces} = require('@animoca/ethereum-contracts/test/contracts/introspection/behaviors/SupportsInterface.behavior');

function behavesLikeERC721Mintable({deploy, errors, interfaces, methods}) {
  const {
    'mint(address,uint256)': mint_ERC721,
    'batchMint(address,uint256[])': batchMint_ERC721,
    'safeMint(address,uint256,bytes)': safeMint_ERC721,
  } = methods || {};

  describe('like an Mintable', function () {
    let accounts, operatorRoleHolder, owner;

    before(async function () {
      accounts = await ethers.getSigners();
      [deployer, operatorRoleHolder, owner] = accounts;
    });

    const fixture = async function () {
      this.token = await deploy(deployer, operatorRoleHolder);

      this.receiver721 = await deployContract('ERC721ReceiverMock', true, this.token.getAddress());
      this.refusingReceiver721 = await deployContract('ERC721ReceiverMock', false, this.token.getAddress());
      this.wrongTokenReceiver721 = await deployContract('ERC721ReceiverMock', true, ethers.ZeroAddress);
    };

    beforeEach(async function () {
      await loadFixture(fixture, this);
    });

    const revertsOnPreconditions = function (mintFunction, data) {
      describe('Pre-conditions', function () {
        it('reverts if minted to the zero address', async function () {
          this.sender = operatorRoleHolder;
          this.to = ethers.ZeroAddress;
          await expectRevert(mintFunction.call(this, 1, data), this.token, errors.MintToAddressZero);
        });

        it('reverts if the token already exists', async function () {
          this.sender = operatorRoleHolder;
          this.to = owner.address;
          await mintFunction.call(this, 1, data);
          await expectRevert(mintFunction.call(this, 1, data), this.token, errors.ExistingToken, {
            tokenId: 1,
          });
        });

        it('reverts if sent by non-operator', async function () {
          this.sender = owner;
          this.to = owner.address;
          await expectRevert(mintFunction.call(this, 1, data), this.token, errors.NotOperator, {
            role: await this.token.OPERATOR_ROLE(),
            account: owner.address,
          });
        });

        if (data !== undefined) {
          it('reverts when sent to a non-receiver contract', async function () {
            this.sender = operatorRoleHolder;
            this.to = await this.token.getAddress();
            await expect(mintFunction.call(this, 1, data)).to.be.reverted;
          });

          it('reverts when sent to an ERC721Receiver which reverts', async function () {
            this.sender = operatorRoleHolder;
            this.to = await this.wrongTokenReceiver721.getAddress();
            await expect(mintFunction.call(this, 1, data)).to.be.reverted;
          });

          it('reverts when sent to an ERC721Receiver which rejects the transfer', async function () {
            this.sender = operatorRoleHolder;
            this.to = await this.refusingReceiver721.getAddress();
            await expectRevert(mintFunction.call(this, 1, data), this.token, errors.SafeTransferRejected, {
              recipient: this.to,
              tokenId: 1,
            });
          });
        }
      });
    };

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
        expect(await this.token.balanceOf(this.to)).to.equal(quantity);
      });

      if (data !== undefined && isERC721Receiver) {
        it('calls onERC721Received', async function () {
          await expect(this.receipt).to.emit(this.receiver721, 'ERC721Received').withArgs(operatorRoleHolder.address, ethers.ZeroAddress, tokenIds, data);
        });
      }
    };

    const mintsByRecipient = function (mintFunction, ids, data) {
      context('when sent to a wallet', function () {
        this.beforeEach(async function () {
          this.sender = operatorRoleHolder;
          this.to = owner.address;
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

    if (mint_ERC721 !== undefined) {
      describe('mint(address,uint256)', function () {
        const mintFn = async function (tokenId, _data) {
          return mint_ERC721(this.token, this.to, tokenId, this.sender);
        };
        const data = undefined;
        revertsOnPreconditions(mintFn, data);
        mintsByRecipient(mintFn, 1, data);
      });
    }

    if (batchMint_ERC721 !== undefined) {
      describe('batchMint(address,uint256[])', function () {
        const mintFn = async function (tokenIds, _data) {
          const ids = Array.isArray(tokenIds) ? tokenIds : [tokenIds];
          return batchMint_ERC721(this.token, this.to, ids, this.sender);
        };
        const data = undefined;
        revertsOnPreconditions(mintFn, data);
        context('with an empty list of tokens', function () {
          mintsByRecipient(mintFn, [], data);
        });
        context('with a single token', function () {
          mintsByRecipient(mintFn, [1], data);
        });
        context('with a list of tokens from the same collection', function () {
          mintsByRecipient(mintFn, [1, 2], data);
        });
      });
    }

    if (safeMint_ERC721 !== undefined) {
      describe('safeMint(address,uint256,bytes)', function () {
        const mintFn = async function (tokenId, data) {
          return safeMint_ERC721(this.token, this.to, tokenId, data, this.sender);
        };
        const data = '0x42';
        revertsOnPreconditions(mintFn, data);
        mintsByRecipient(mintFn, 1, data);
      });
    }

    if (interfaces && interfaces.ERC721Mintable) {
      supportsInterfaces(['IERC721Mintable']);
    }
  });
}

module.exports = {
    behavesLikeERC721Mintable,
};
