const chai = require("chai");
var chaiAsPromised = require("chai-as-promised");

chai.use(chaiAsPromised);

const { expect } = require("chai");

const { ethers } = require("hardhat");
const { BigNumber } = ethers;
const { setBlockTimestamp } = require("./utilities/time");
const Web3 = require("web3");
const { parseEther } = require("ethers/lib/utils");
const web3 = new Web3("");

async function getCurrentTimestamp() {
  let currentBlockNumber = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(currentBlockNumber);
  const timestamp = block.timestamp;
  return timestamp;
}

describe.only("Ashwin StakingPoolUpdatableFixedAPR", function async() {
  const depositAmount = parseEther("1000000000000");

  function calculateYearlyRewards(withdrawalTime, depositTime, rewardAmount) {
    const diffTime = withdrawalTime - depositTime;
    console.log("difftime", diffTime);

    const perSecReward = rewardAmount / diffTime;

    console.log("perSecReward", perSecReward);

    const totalRewardYearly = perSecReward * 365 * 86400;

    console.log("totalRewardYearly ", totalRewardYearly);

    return totalRewardYearly;
  }

  function calculateAPRNEW(depositAmount, rewardAmount) {
    return (rewardAmount * 100) / depositAmount;
  }

  let lpTokenInstance,
    stakingPoolInstance,
    depositor1,
    depositor2,
    owner,
    accounts,
    rewardToken1Instance,
    startRewardTimestamp,
    initParams;

  let initialBlockNumber, endTimestamp;
  let encodedData;

  let expectedAPR = parseEther("0.25"); // 25%

  beforeEach(async () => {
    accounts = await ethers.getSigners();

    owner = accounts[0];
    depositor1 = accounts[1];
    depositor2 = accounts[2];
    routerAddress = "0x0000000000000000000000000000000000000000";

    const MockToken = await ethers.getContractFactory("MockERC20");

    lpTokenInstance = await MockToken.connect(depositor1).deploy(
      "LPTT",
      "LP Test Token",
      18
    );

    await lpTokenInstance
      .connect(depositor1)
      .transfer(depositor2.address, depositAmount);

    rewardToken1Instance = await MockToken.connect(owner).deploy(
      "RT1",
      "Reward Token 1",
      18
    );

    const currentBlockNumber = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(currentBlockNumber);
    const timestampBefore = blockBefore.timestamp;

    startRewardTimestamp = timestampBefore + 10;

    initialBlockNumber = BigNumber.from(startRewardTimestamp);
    endTimestamp = initialBlockNumber.add(50);
    await setBlockTimestamp(Number(startRewardTimestamp));

    initParams = {
      rewardToken: rewardToken1Instance.address,
      amount: parseEther("1000000000"),
      lpToken: lpTokenInstance.address,
      startBlock: initialBlockNumber.add(6),
      endBlock: endTimestamp,
      endBlockDuration: endTimestamp,
      withdrawalFeeBP: 10,
      harvestInterval: 0,
      maxAllowedDeposit: ethers.constants.MaxUint256,
    };

    encodedData = web3.eth.abi.encodeParameters(
      [
        "address",
        "uint256",
        "address",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
        "address",
        "uint16",
        "address",
        "string",
        "string",
        "address",
        "uint256",
        "uint256",
      ],
      [
        initParams.rewardToken,
        0,
        initParams.lpToken,
        initParams.startBlock,
        initParams.endBlock,
        expectedAPR,
        initParams.harvestInterval,
        "0xb60B993862673A87C16E4e6e5F75397131EEBb3e",
        initParams.withdrawalFeeBP,
        owner.address,
        "https://ipfs.infura.io/ipfs/QmTfuFKToyzLCJWd3wgX9CeewdWsosY9H4B2CUHftp76kc",
        "https://ipfs.infura.io/ipfs/QmTfuFKToyzLCJWd3wgX9CeewdWsosY9H4B2CUHftp76kc",
        routerAddress,
        initParams.endBlockDuration,
        initParams.maxAllowedDeposit,
      ]
    );
    const StakingPoolAPRContract = await ethers.getContractFactory(
      "StakingPoolUpdatableFixedAPR"
    );

    stakingPoolInstance = await StakingPoolAPRContract.connect(owner).deploy(
      encodedData
    );

    await rewardToken1Instance
      .connect(owner)
      .transfer(stakingPoolInstance.address, initParams.amount);
  });

  it.only("should sucessfully withdraw reward", async function() {
    await lpTokenInstance
      .connect(depositor1)
      .approve(stakingPoolInstance.address, depositAmount);

    let currentBlockNumber = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(currentBlockNumber);
    const beforeDepositTimestamp = blockBefore.timestamp;

    console.log("before deposit timestamp ", await getCurrentTimestamp());
    await stakingPoolInstance.connect(depositor1).deposit(depositAmount);

    await setBlockTimestamp(Number(endTimestamp));
    console.log("endTimestamp ", endTimestamp);
    console.log("before withdraw timestamp ", await getCurrentTimestamp());
    await stakingPoolInstance.connect(depositor1).withdraw(depositAmount);

    const balanceOfDepositor = await rewardToken1Instance.balanceOf(
      depositor1.address
    );

    const rewardAmount = "34800000000000";
    console.log("beforeDepositTimestamp ", beforeDepositTimestamp);
    console.log(startRewardTimestamp, endTimestamp);
    const calculatedRewards = calculateYearlyRewards(
      Number(endTimestamp),
      Number(initParams.startBlock),
      rewardAmount
    );

    const calculatedAPR = calculateAPRNEW(depositAmount, calculatedRewards);

    console.log("calculated APR ", calculatedAPR);

    console.log("balanceOfDepositor ", balanceOfDepositor.toString());
    expect(balanceOfDepositor.toString()).to.equal(rewardAmount);
  });
});
