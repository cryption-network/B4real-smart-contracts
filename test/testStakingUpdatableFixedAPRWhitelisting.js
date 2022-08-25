const chai = require("chai");
var chaiAsPromised = require("chai-as-promised");

chai.use(chaiAsPromised);

var assert = chai.assert;
const { expect } = require("chai");
const { MerkleTree } = require('merkletreejs'); 
const keccak256 = require('keccak256');
const { ethers } = require("hardhat");
const { BigNumber } = ethers;
const { setBlockTimestamp } = require("./utilities/time");
const Web3 = require('web3');
const { parseEther } = require("ethers/lib/utils");
const web3 = new Web3('');

async function getCurrentTimestamp() {
  let currentBlockNumber = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(currentBlockNumber);
  const timestamp = block.timestamp;
  return timestamp;
}

function hashToken(account) {
  const hashedValue = Buffer.from(ethers.utils.solidityKeccak256(['address'], [account]).slice(2), 'hex')
  return hashedValue;
}

describe("StakingPoolUpdatableFixedAPRWhitelisting", function async() {
  const depositAmount = BigNumber.from("10000000000000000");

  function calculateYearlyRewards(withdrawalTime, depositTime, rewardAmount) {
    const diffTime = depositTime - withdrawalTime;

    const perSecReward = rewardAmount / diffTime;

    const totalRewardYearly = perSecReward * 365 * 86400;

    console.log('totalRewardYearly ', totalRewardYearly);

    return totalRewardYearly;

  }

  let lpTokenInstance,
    stakingPoolInstance,
    owner,
    accounts,
    rewardToken1Instance,
    initParams,
    whitelistedDepositor1,
    whitelistedDepositor2,
    whitelistedDepositor1Proof,
    whitelistedDepositor2Proof,
    merkleTree,
    routerAddress;

  let initialBlockNumber, endTimestamp;
  let encodedData;

  const blockRewardForToken1 = "100000000000000";
  let expectedAPR = "250000000000000000"; // 25%

  beforeEach(async () => {
    accounts = await ethers.getSigners();

    owner = accounts[0];
    whitelistedDepositor1 = accounts[1];
    whitelistedDepositor2 = accounts[4];
    feeAddress = accounts[5];
    referrer = accounts[7];
    routerAddress = '0x0000000000000000000000000000000000000000'

    const MockToken = await ethers.getContractFactory("MockERC20");

    lpTokenInstance = await MockToken.connect(whitelistedDepositor1).deploy(
      "LPTT",
      "LP Test Token",
      18
    );

    await lpTokenInstance.connect(whitelistedDepositor1).transfer(whitelistedDepositor2.address, depositAmount);

    rewardToken1Instance = await MockToken.connect(owner).deploy(
      "RT1",
      "Reward Token 1",
      18
    );

    rewardToken2Instance = await MockToken.connect(owner).deploy(
      "RT2",
      "Reward Token 2",
      18
    );

    rewardToken3Instance = await MockToken.connect(owner).deploy(
      "RT3",
      "Reward Token 3",
      18
    );

    const currentBlockNumber = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(currentBlockNumber);
    const timestampBefore = blockBefore.timestamp;

    const startRewardTimestamp = timestampBefore + 10;

    initialBlockNumber = BigNumber.from(startRewardTimestamp);
    endTimestamp = initialBlockNumber.add(50);

    setBlockTimestamp(Number(startRewardTimestamp));

    initParams = {
      rewardToken: rewardToken1Instance.address,
      amount: "1000000000000000000000",
      lpToken: lpTokenInstance.address,
      blockReward: blockRewardForToken1,
      startBlock: initialBlockNumber.add(6),
      endBlock: endTimestamp,
      endBlockDuration: endTimestamp,
      withdrawalFeeBP: 10,
      harvestInterval: 0,
      maxAllowedDeposit: parseEther("200")
    };

    const hashData = [
      hashToken(whitelistedDepositor1.address),
      hashToken(whitelistedDepositor2.address)
    ];

    merkleTree = new MerkleTree(hashData, keccak256, { sortPairs: true });

    encodedData = web3.eth.abi.encodeParameters(
      [
        'address', 'address',
        'uint256', 'uint256',
        'uint256', 'uint256',
        'uint256', 'address',
        'uint16', 'address',
        'string', 'string',
        'address', 'uint256',
        'bytes32'
      ],
      [
        initParams.rewardToken, initParams.lpToken,
        initParams.startBlock, initParams.endBlock,
        initParams.amount, expectedAPR,
        initParams.harvestInterval, '0xb60B993862673A87C16E4e6e5F75397131EEBb3e',
        initParams.withdrawalFeeBP, owner.address,
        "https://ipfs.infura.io/ipfs/QmTfuFKToyzLCJWd3wgX9CeewdWsosY9H4B2CUHftp76kc", "https://ipfs.infura.io/ipfs/QmTfuFKToyzLCJWd3wgX9CeewdWsosY9H4B2CUHftp76kc",
        routerAddress, initParams.endBlockDuration,
        merkleTree.getHexRoot()
      ]
    );

    console.log('merkleTree.getHexRoot() ', merkleTree.getHexRoot());
    const StakingPoolAPRContract = await ethers.getContractFactory('StakingPoolUpdatableFixedAPRWhitelisting');

    stakingPoolInstance = await StakingPoolAPRContract.connect(owner).deploy();

    await rewardToken1Instance
      .connect(owner)
      .approve(stakingPoolInstance.address, initParams.amount);
    await stakingPoolInstance.connect(owner).init(encodedData);

    whitelistedDepositor1Proof = merkleTree.getHexProof(hashToken(whitelistedDepositor1.address));
    whitelistedDepositor2Proof = merkleTree.getHexProof(hashToken(whitelistedDepositor2.address));

  });

  it("should sucessfully withdraw reward", async function () {
    await lpTokenInstance
      .connect(whitelistedDepositor1)
      .approve(stakingPoolInstance.address, depositAmount);

    let currentBlockNumber = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(currentBlockNumber);
    const beforeDepositTimestamp = blockBefore.timestamp;

    console.log('before deposit timestamp ',await getCurrentTimestamp());
    await stakingPoolInstance.connect(whitelistedDepositor1).deposit(depositAmount, whitelistedDepositor1Proof);
    
    await setBlockTimestamp(Number(endTimestamp));
    console.log('endTimestamp ', endTimestamp);
    console.log('before withdraw timestamp ', await getCurrentTimestamp());
    await stakingPoolInstance.connect(whitelistedDepositor1).withdraw(depositAmount);

    const balanceOfDepositor = await rewardToken1Instance.balanceOf(
      whitelistedDepositor1.address
    );

    const rewardAmount = "3488077076";
    console.log('beforeDepositTimestamp ', beforeDepositTimestamp);
    const calculatedAPR = calculateYearlyRewards(Number(endTimestamp) + 1, Number(beforeDepositTimestamp) + 1, rewardAmount);

    console.log('calculated APR ', calculatedAPR);

    console.log('balanceOfDepositor ', balanceOfDepositor.toString());
    expect(balanceOfDepositor.toString()).to.equal(rewardAmount);
  });

  it("should sucessfully immediately withdraw reward", async function () {
    await lpTokenInstance
      .connect(whitelistedDepositor1)
      .approve(stakingPoolInstance.address, depositAmount);

    await stakingPoolInstance.connect(whitelistedDepositor1).deposit(depositAmount, whitelistedDepositor1Proof);
    await setBlockTimestamp(Number(endTimestamp) - 1);

    console.log('endTimestamp ', endTimestamp);
    await stakingPoolInstance.connect(whitelistedDepositor1).withdraw(depositAmount);

    const balanceOfDepositor = await rewardToken1Instance.balanceOf(
      whitelistedDepositor1.address
    );

    console.log('balanceOfDepositor ', balanceOfDepositor.toString());
    expect(balanceOfDepositor.toString()).to.equal("3488077076");
  });

  it("should sucessfully withdraw reward when 2 users deposit", async function () {
    await lpTokenInstance
      .connect(whitelistedDepositor1)
      .approve(stakingPoolInstance.address, depositAmount);
    await lpTokenInstance
      .connect(whitelistedDepositor2)
      .approve(stakingPoolInstance.address, depositAmount);
    console.log('depositAmount/2 ', depositAmount / 2);
    console.log('----------------------------------------------------------');
    console.log('depositAmount ', depositAmount);

    let currentBlockNumber = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(currentBlockNumber);
    const beforeDepositTimestamp = blockBefore.timestamp;
    console.log('user 1 deposit')
    await stakingPoolInstance.connect(whitelistedDepositor1).deposit(depositAmount, whitelistedDepositor1Proof);
    const afterDepositTimestamp = Number(endTimestamp - 40);
    await setBlockTimestamp(afterDepositTimestamp);

    await stakingPoolInstance.connect(whitelistedDepositor2).deposit(depositAmount / 2, whitelistedDepositor2Proof);

    await setBlockTimestamp(Number(endTimestamp));

    console.log('user 1 withdraw')
    await stakingPoolInstance.connect(whitelistedDepositor1).withdraw(depositAmount);
    currentBlockNumber = await ethers.provider.getBlockNumber();
    let blockAfterWithdrawal;
    blockAfterWithdrawal = await ethers.provider.getBlock(currentBlockNumber);
    const afterWithdrawalTimestampDepositor1 = blockBefore.timestamp;

    await stakingPoolInstance.connect(whitelistedDepositor2).withdraw(depositAmount / 2);

    const balanceOfDepositor = await rewardToken1Instance.balanceOf(
      whitelistedDepositor1.address
    );

    const balanceOfDepositor2 = await rewardToken1Instance.balanceOf(
      whitelistedDepositor2.address
    );

    const rewardAmount = "3488077089";

    const calculatedAPR = calculateYearlyRewards(beforeDepositTimestamp + 1, afterWithdrawalTimestampDepositor1, rewardAmount);

    console.log('calculated APR ', calculatedAPR);

    console.log('balanceOfDepositor 1 ', balanceOfDepositor.toString());
    console.log('balanceOfDepositor 2 ', balanceOfDepositor2.toString());
    expect(balanceOfDepositor.toString()).to.equal(rewardAmount);
    expect(balanceOfDepositor2.toString()).to.equal("1545852347");
  });

  it("should sucessfully withdraw reward when 2 users deposit after increasing APR", async function () {
    const startTimestamp = await getCurrentTimestamp();
    const endTimestamp = startTimestamp + 300;
    encodedData = web3.eth.abi.encodeParameters(
      [
        'address', 'address',
        'uint256', 'uint256',
        'uint256', 'uint256',
        'uint256', 'address',
        'uint16', 'address',
        'string', 'string',
        'address', 'uint256',
        'uint256',
      ],
      [
        initParams.rewardToken, initParams.lpToken,
        startTimestamp, endTimestamp,
        initParams.amount, expectedAPR,
        initParams.harvestInterval, '0xb60B993862673A87C16E4e6e5F75397131EEBb3e',
        initParams.withdrawalFeeBP, owner.address,
        "https://ipfs.infura.io/ipfs/QmTfuFKToyzLCJWd3wgX9CeewdWsosY9H4B2CUHftp76kc", "https://ipfs.infura.io/ipfs/QmTfuFKToyzLCJWd3wgX9CeewdWsosY9H4B2CUHftp76kc",
        routerAddress, endTimestamp,
        initParams.maxAllowedDeposit,
      ]
    );

    const StakingPoolAPRContract = await ethers.getContractFactory('StakingPoolUpdatableFixedAPR');

    let stakingPoolUpdateableAPRInstance = await StakingPoolAPRContract.connect(owner).deploy();

    await rewardToken1Instance
      .connect(owner)
      .approve(stakingPoolUpdateableAPRInstance.address, initParams.amount);
    await stakingPoolUpdateableAPRInstance.connect(owner).init(encodedData);

    await lpTokenInstance
      .connect(whitelistedDepositor1)
      .approve(stakingPoolUpdateableAPRInstance.address, depositAmount);
    await lpTokenInstance
      .connect(whitelistedDepositor2)
      .approve(stakingPoolUpdateableAPRInstance.address, depositAmount);

    let currentBlockNumber = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(currentBlockNumber);
    const beforeDepositTimestamp = blockBefore.timestamp;
    await stakingPoolUpdateableAPRInstance.connect(whitelistedDepositor1).deposit(depositAmount);

    await stakingPoolUpdateableAPRInstance.connect(whitelistedDepositor2).deposit(depositAmount);

    await setBlockTimestamp(Number(endTimestamp) - 100);

    // user 1 withdraw
    await stakingPoolUpdateableAPRInstance.connect(whitelistedDepositor1).withdraw(depositAmount);
    currentBlockNumber = await ethers.provider.getBlockNumber();
    let blockAfterWithdrawal;
    blockAfterWithdrawal = await ethers.provider.getBlock(currentBlockNumber);

    // user 2 withdraw
    await stakingPoolUpdateableAPRInstance.connect(whitelistedDepositor2).withdraw(depositAmount);

    const balanceOfDepositor = await rewardToken1Instance.balanceOf(
      whitelistedDepositor1.address
    );

    const balanceOfDepositor2 = await rewardToken1Instance.balanceOf(
      whitelistedDepositor2.address
    );

    const rewardAmount = "15458523502";

    console.log('balanceOfDepositor 1 ', balanceOfDepositor.toString());
    console.log('balanceOfDepositor 2 ', balanceOfDepositor2.toString());
    expect(balanceOfDepositor.toString()).to.equal(rewardAmount);
    expect(balanceOfDepositor2.toString()).to.equal("15458523502");

    const newAPR = BigNumber.from((30 / 100 * 1e18).toString()); // 30%
    await stakingPoolUpdateableAPRInstance.connect(owner).updateExpectedAPR(newAPR, 0);

    await lpTokenInstance
      .connect(whitelistedDepositor1)
      .approve(stakingPoolUpdateableAPRInstance.address, depositAmount);
    await lpTokenInstance
      .connect(whitelistedDepositor2)
      .approve(stakingPoolUpdateableAPRInstance.address, depositAmount);
    await stakingPoolUpdateableAPRInstance.connect(whitelistedDepositor1).deposit(depositAmount);
    await stakingPoolUpdateableAPRInstance.connect(whitelistedDepositor2).deposit(depositAmount / 2);

    await setBlockTimestamp(Number(endTimestamp));
    await stakingPoolUpdateableAPRInstance.connect(whitelistedDepositor1).withdraw(depositAmount);
    await stakingPoolUpdateableAPRInstance.connect(whitelistedDepositor2).withdraw(depositAmount / 2);

    const depositor1Withdrawal = await rewardToken1Instance.balanceOf(whitelistedDepositor1.address);

    const depositor2Withdrawal = await rewardToken1Instance.balanceOf(whitelistedDepositor2.address);

    expect(depositor1Withdrawal.toString()).to.equal("24400684783");
    expect(depositor2Withdrawal.toString()).to.equal("19882039455");
  });

});