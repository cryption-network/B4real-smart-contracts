const chai = require("chai");
var chaiAsPromised = require("chai-as-promised");

chai.use(chaiAsPromised);

var assert = chai.assert;
const { expect } = require("chai");

const { ethers } = require("hardhat");
const { BigNumber } = ethers;
const { setBlockTimestamp } = require("./utilities/time");
const Web3 = require('web3');
const { parseEther } = require("ethers/lib/utils");
const web3 = new Web3('');

describe("StakingPoolFixedAPR", function async() {
  const depositAmount = BigNumber.from("10000000000000000");

  function calculateYearlyRewards(withdrawalTime, depositTime, rewardAmount) {
    const diffTime = depositTime - withdrawalTime;

    const perSecReward = rewardAmount / diffTime;

    console.log('perSecReward asda', perSecReward);

    const totalRewardYearly = perSecReward * 365 * 86400;

    console.log('totalRewardYearly ', totalRewardYearly);

    return totalRewardYearly;

  }

  let lpTokenInstance,
    stakingPoolInstance,
    depositor1,
    depositor2,
    owner,
    accounts,
    rewardToken1Instance,
    initParams,
    routerAddress;

  let initialBlockNumber, endTimestamp;
  let encodedData;

  const blockRewardForToken1 = "100000000000000";
  let expectedAPR = 2500;

  beforeEach(async () => {
    accounts = await ethers.getSigners();

    owner = accounts[0];
    depositor1 = accounts[1];
    depositor2 = accounts[4];
    feeAddress = accounts[5];
    referrer = accounts[7];
    routerAddress = '0x0000000000000000000000000000000000000000'

    const MockToken = await ethers.getContractFactory("MockERC20");

    lpTokenInstance = await MockToken.connect(depositor1).deploy(
      "LPTT",
      "LP Test Token",
      18
    );

    await lpTokenInstance.connect(depositor1).transfer(depositor2.address, depositAmount);

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

    const FeeManager = await ethers.getContractFactory('MockFeeManager');

    const feeManager = await FeeManager.connect(owner).deploy();

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

    encodedData = web3.eth.abi.encodeParameters(
      [
        'address', 'address',
        'uint256', 'uint256',
        'uint256', 'uint256',
        'uint256', 'address',
        'uint16', 'address',
        'string', 'string',
        'address', 'uint256',
        'uint256', 'uint256'
      ],
      [
        initParams.rewardToken, initParams.lpToken,
        initParams.startBlock, initParams.endBlock,
        initParams.amount, initParams.blockReward,
        initParams.harvestInterval, '0xb60B993862673A87C16E4e6e5F75397131EEBb3e',
        initParams.withdrawalFeeBP, owner.address,
        "https://ipfs.infura.io/ipfs/QmTfuFKToyzLCJWd3wgX9CeewdWsosY9H4B2CUHftp76kc", "https://ipfs.infura.io/ipfs/QmTfuFKToyzLCJWd3wgX9CeewdWsosY9H4B2CUHftp76kc",
        routerAddress, initParams.endBlockDuration,
        initParams.maxAllowedDeposit,
        expectedAPR
      ]
    );

    const StakingPoolAPRContract = await ethers.getContractFactory('StakingPoolFixedAPR');

    stakingPoolInstance = await StakingPoolAPRContract.connect(owner).deploy();

    await rewardToken1Instance
      .connect(owner)
      .approve(stakingPoolInstance.address, initParams.amount);
    await stakingPoolInstance.connect(owner).init(encodedData);
  });

  it("should sucessfully withdraw reward", async function () {
    await lpTokenInstance
      .connect(depositor1)
      .approve(stakingPoolInstance.address, depositAmount);

    let currentBlockNumber = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(currentBlockNumber);
    const beforeDepositTimestamp = blockBefore.timestamp;

    await stakingPoolInstance.connect(depositor1).deposit(depositAmount);

    await setBlockTimestamp(Number(endTimestamp));
    console.log('endTimestamp ', endTimestamp);
    await stakingPoolInstance.connect(depositor1).withdraw(depositAmount);

    const balanceOfDepositor = await rewardToken1Instance.balanceOf(
      depositor1.address
    );

    const rewardAmount = "3488077118";

    const calculatedAPR = calculateYearlyRewards(Number(endTimestamp) + 1, Number(beforeDepositTimestamp) + 1, rewardAmount);

    console.log('calculated APR ', calculatedAPR);

    console.log('balanceOfDepositor ', balanceOfDepositor.toString());
    expect(balanceOfDepositor.toString()).to.equal(rewardAmount);
  });

  it("should sucessfully immediately withdraw reward", async function () {
    await lpTokenInstance
      .connect(depositor1)
      .approve(stakingPoolInstance.address, depositAmount);

    let currentBlockNumber = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(currentBlockNumber);

    await stakingPoolInstance.connect(depositor1).deposit(depositAmount);

    console.log('endTimestamp ', endTimestamp);
    await stakingPoolInstance.connect(depositor1).withdraw(depositAmount);

    const balanceOfDepositor = await rewardToken1Instance.balanceOf(
      depositor1.address
    );

    console.log('balanceOfDepositor ', balanceOfDepositor.toString());
    expect(balanceOfDepositor.toString()).to.equal("0");
  });

  it("should sucessfully withdraw reward when 2 users deposit", async function () {
    await lpTokenInstance
      .connect(depositor1)
      .approve(stakingPoolInstance.address, depositAmount);
    await lpTokenInstance
      .connect(depositor2)
      .approve(stakingPoolInstance.address, depositAmount);
    console.log('depositAmount/2 ', depositAmount / 2);
    console.log('----------------------------------------------------------');
    console.log('depositAmount ', depositAmount);

    let currentBlockNumber = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(currentBlockNumber);
    const beforeDepositTimestamp = blockBefore.timestamp;
    console.log('user 1 deposit')
    await stakingPoolInstance.connect(depositor1).deposit(depositAmount);
    const afterDepositTimestamp = Number(endTimestamp - 40);
    await setBlockTimestamp(afterDepositTimestamp);

    await stakingPoolInstance.connect(depositor2).deposit(depositAmount / 2);

    await setBlockTimestamp(Number(endTimestamp));

    console.log('user 1 withdraw')
    await stakingPoolInstance.connect(depositor1).withdraw(depositAmount);
    currentBlockNumber = await ethers.provider.getBlockNumber();
    let blockAfterWithdrawal;
    blockAfterWithdrawal = await ethers.provider.getBlock(currentBlockNumber);
    const afterWithdrawalTimestampDepositor1 = blockBefore.timestamp;

    await stakingPoolInstance.connect(depositor2).withdraw(depositAmount / 2);

    const balanceOfDepositor = await rewardToken1Instance.balanceOf(
      depositor1.address
    );

    const balanceOfDepositor2 = await rewardToken1Instance.balanceOf(
      depositor2.address
    );

    const rewardAmount = "3488077118";

    const calculatedAPR = calculateYearlyRewards(beforeDepositTimestamp + 1, afterWithdrawalTimestampDepositor1, rewardAmount);

    console.log('calculated APR ', calculatedAPR);

    console.log('balanceOfDepositor 1 ', balanceOfDepositor.toString());
    console.log('balanceOfDepositor 2 ', balanceOfDepositor2.toString());
    expect(balanceOfDepositor.toString()).to.equal(rewardAmount);
    expect(balanceOfDepositor2.toString()).to.equal("1545852359");
  });
});