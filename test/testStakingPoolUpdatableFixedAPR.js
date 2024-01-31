const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther } = ethers.utils;

function calculateYearlyRewards(withdrawalTime, depositTime, rewardAmount) {
  const diffTime = withdrawalTime - depositTime;
  const perSecReward = rewardAmount.div(diffTime);
  const totalRewardYearly = perSecReward.mul(365 * 86400);
  return totalRewardYearly;
}

function calculateAPRNEW(depositAmount, rewardAmount) {
  return Number(rewardAmount.mul(10000).div(depositAmount)) / 100;
}

describe("StakingPoolUpdatableFixedAPR", function() {
  const depositAmount = parseEther("10");

  let lpTokenInstance,
    stakingPoolInstance,
    depositor1,
    depositor2,
    rewardToken1Instance;
  let startRewardTimestamp, endTimestamp;
  let encodedData;

  beforeEach(async () => {
    [owner, depositor1, depositor2, ..._] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    lpTokenInstance = await MockToken.deploy("LPTT", "LP Test Token", 18);
    rewardToken1Instance = await MockToken.deploy("RT1", "Reward Token 1", 18);

    const currentBlockNumber = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(currentBlockNumber);
    startRewardTimestamp = block.timestamp + 10;
    endTimestamp = startRewardTimestamp + 100;

    const initParams = {
      rewardToken: rewardToken1Instance.address,
      amount: parseEther("10000"),
      lpToken: lpTokenInstance.address,
      startBlock: startRewardTimestamp,
      endBlock: endTimestamp,
      withdrawalFeeBP: 0,
      harvestInterval: 0,
      maxAllowedDeposit: ethers.constants.MaxUint256,
    };

    encodedData = ethers.utils.defaultAbiCoder.encode(
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
        parseEther("0.25"), // 25% APR
        initParams.harvestInterval,
        owner.address,
        initParams.withdrawalFeeBP,
        owner.address,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        initParams.endBlock,
        initParams.maxAllowedDeposit,
      ]
    );

    const StakingPoolAPRContract = await ethers.getContractFactory(
      "StakingPoolUpdatableFixedAPR"
    );
    stakingPoolInstance = await StakingPoolAPRContract.deploy(encodedData);
    await rewardToken1Instance.transfer(
      stakingPoolInstance.address,
      initParams.amount
    );
  });

  it("should accurately calculate rewards and APR", async function() {
    // Transfer LP tokens to depositor
    await lpTokenInstance.transfer(depositor1.address, parseEther("100"));
    await lpTokenInstance
      .connect(depositor1)
      .approve(stakingPoolInstance.address, depositAmount);
    await stakingPoolInstance.connect(depositor1).deposit(depositAmount);

    // Simulate time passing for rewards to accrue
    await ethers.provider.send("evm_setNextBlockTimestamp", [endTimestamp]);
    await ethers.provider.send("evm_mine");

    await stakingPoolInstance.connect(depositor1).withdraw(depositAmount);

    const balanceOfDepositor = await rewardToken1Instance.balanceOf(
      depositor1.address
    );
    const rewardAmount = balanceOfDepositor;

    const calculatedRewards = calculateYearlyRewards(
      endTimestamp,
      startRewardTimestamp,
      rewardAmount
    );
    const calculatedAPR = calculateAPRNEW(depositAmount, calculatedRewards);

    const expectedAPR = Number(ethers.utils.parseUnits("0.25", 2));
    expect(calculatedAPR).to.be.closeTo(expectedAPR, 1);
  });

  it("should handle deposits and withdrawals from multiple users correctly", async function() {
    // User A and User B deposit different amounts at different times
    const depositAmountA = parseEther("20");
    const depositAmountB = parseEther("50");
    const userA = depositor1;
    const userB = depositor2;

    // Transfer LP tokens to both users
    await lpTokenInstance.transfer(userA.address, depositAmountA);
    await lpTokenInstance.transfer(userB.address, depositAmountB);

    // User A deposits
    await lpTokenInstance
      .connect(userA)
      .approve(stakingPoolInstance.address, depositAmountA);
    await stakingPoolInstance.connect(userA).deposit(depositAmountA);

    // Advance time by some duration
    let midTimestamp = startRewardTimestamp + 20;
    await ethers.provider.send("evm_setNextBlockTimestamp", [midTimestamp]);
    await ethers.provider.send("evm_mine");

    // User B deposits
    await lpTokenInstance
      .connect(userB)
      .approve(stakingPoolInstance.address, depositAmountB);
    await stakingPoolInstance.connect(userB).deposit(depositAmountB);

    // Further advance time to the end
    await ethers.provider.send("evm_setNextBlockTimestamp", [endTimestamp]);
    await ethers.provider.send("evm_mine");

    // User A and User B withdraw
    await stakingPoolInstance.connect(userA).withdraw(depositAmountA);
    await stakingPoolInstance.connect(userB).withdraw(depositAmountB);

    // Calculate and validate rewards for User A and User B
    const balanceOfUserA = await rewardToken1Instance.balanceOf(userA.address);
    const rewardAmountA = balanceOfUserA;
    const calculatedRewardsA = calculateYearlyRewards(
      endTimestamp,
      startRewardTimestamp,
      rewardAmountA
    );
    const calculatedAPRA = calculateAPRNEW(depositAmountA, calculatedRewardsA);

    const balanceOfUserB = await rewardToken1Instance.balanceOf(userB.address);
    const rewardAmountB = balanceOfUserB;
    const calculatedRewardsB = calculateYearlyRewards(
      endTimestamp,
      midTimestamp,
      rewardAmountB
    );
    const calculatedAPRB = calculateAPRNEW(depositAmountB, calculatedRewardsB);

    const expectedAPR = Number(ethers.utils.parseUnits("0.25", 2));
    expect(calculatedAPRA).to.be.closeTo(expectedAPR, 1);
    expect(calculatedAPRB).to.be.closeTo(expectedAPR, 1);
  });

  it("should accurately calculate rewards and APR after increasing APR", async function() {
    // Transfer LP tokens to depositor
    await lpTokenInstance.transfer(depositor1.address, parseEther("100"));
    await lpTokenInstance
      .connect(depositor1)
      .approve(stakingPoolInstance.address, depositAmount);
    await stakingPoolInstance.connect(depositor1).deposit(depositAmount);

    // Advance time by some duration
    let midTimestamp = startRewardTimestamp + 15;
    await ethers.provider.send("evm_setNextBlockTimestamp", [midTimestamp]);
    await ethers.provider.send("evm_mine");

    await stakingPoolInstance.connect(depositor1).withdraw(depositAmount);

    const balanceOfDepositor = await rewardToken1Instance.balanceOf(
      depositor1.address
    );
    const rewardAmount = balanceOfDepositor;

    const calculatedRewards = calculateYearlyRewards(
      midTimestamp,
      startRewardTimestamp,
      rewardAmount
    );
    const calculatedAPR = calculateAPRNEW(depositAmount, calculatedRewards);

    const expectedAPR = Number(ethers.utils.parseUnits("0.25", 2));
    expect(calculatedAPR).to.be.closeTo(expectedAPR, 1.5);

    // Update the APR to 30%
    const newAPR = ethers.utils.parseEther("0.30"); // 30% APR
    await stakingPoolInstance.updateExpectedAPR(newAPR, 0);

    // User deposits again
    await lpTokenInstance
      .connect(depositor1)
      .approve(stakingPoolInstance.address, depositAmount);
    await stakingPoolInstance.connect(depositor1).deposit(depositAmount);

    await ethers.provider.send("evm_setNextBlockTimestamp", [endTimestamp]);
    await ethers.provider.send("evm_mine");

    // User withdraws again
    await stakingPoolInstance.connect(depositor1).withdraw(depositAmount);

    // Calculate the rewards and APR after the APR update
    const newBalanceOfDepositor = await rewardToken1Instance.balanceOf(
      depositor1.address
    );
    const newRewardAmount = newBalanceOfDepositor.sub(rewardAmount); // Subtract the previous rewards

    const newCalculatedRewards = calculateYearlyRewards(
      endTimestamp,
      midTimestamp, // Use the previous endTimestamp as the start for the new period
      newRewardAmount
    );
    const newCalculatedAPR = calculateAPRNEW(
      depositAmount,
      newCalculatedRewards
    );

    const expectedNewAPR = Number(ethers.utils.parseUnits("0.30", 2)); // 30%
    expect(newCalculatedAPR).to.be.closeTo(expectedNewAPR, 1.5);
  });

  it("should calculate and distribute rewards correctly over time", async function() {
    const depositAmount = parseEther("5");
    await lpTokenInstance.transfer(depositor1.address, depositAmount);
    await lpTokenInstance
      .connect(depositor1)
      .approve(stakingPoolInstance.address, depositAmount);
    await stakingPoolInstance.connect(depositor1).deposit(depositAmount);

    // Simulate time for rewards to accrue
    await ethers.provider.send("evm_increaseTime", [endTimestamp]); // Increase by 1 day
    await ethers.provider.send("evm_mine");

    const pendingRewards = await stakingPoolInstance.pendingReward(
      depositor1.address,
      0
    );
    const rewardAmount = pendingRewards;

    const calculatedRewards = calculateYearlyRewards(
      endTimestamp,
      startRewardTimestamp,
      rewardAmount
    );
    const calculatedAPR = calculateAPRNEW(depositAmount, calculatedRewards);

    const expectedAPR = Number(ethers.utils.parseUnits("0.25", 2));
    expect(calculatedAPR).to.be.closeTo(expectedAPR, 1.5);
  });

  it("should be able to emergency withdraw", async function() {
    const depositAmount = parseEther("5");
    await lpTokenInstance.transfer(depositor1.address, depositAmount);
    const beforeDepositBalance = await lpTokenInstance.balanceOf(
      depositor1.address
    );
    await lpTokenInstance
      .connect(depositor1)
      .approve(stakingPoolInstance.address, depositAmount);
    await stakingPoolInstance.connect(depositor1).deposit(depositAmount);

    // Simulate time for rewards to accrue
    await ethers.provider.send("evm_increaseTime", [endTimestamp]); // Increase by 1 day
    await ethers.provider.send("evm_mine");

    await stakingPoolInstance.connect(depositor1).emergencyWithdraw();
    const aftetEmergencyWithdrawBalance = await lpTokenInstance.balanceOf(
      depositor1.address
    );

    const balanceOfDepositor = await rewardToken1Instance.balanceOf(
      depositor1.address
    );
    const rewardAmount = balanceOfDepositor;

    expect(Number(rewardAmount)).to.equal(0);
    expect(Number(aftetEmergencyWithdrawBalance)).to.equal(
      Number(beforeDepositBalance)
    );
  });
});
