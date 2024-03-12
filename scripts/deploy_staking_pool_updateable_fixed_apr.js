// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat");

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main() {
  const initParams = {
    rewardToken: "0x6be961cc7f0f182a58D1fa8052C5e92026CBEcAa", //B4Real Credits
    amount: parseEther("0"),
    lpToken: "0x3c27564e3161bbaA6E7d2f0320fa4BE77AED54da", //B4Real Token
    startBlock: startRewardTimestamp,
    endBlock: endTimestamp,
    withdrawalFeeBP: 0,
    harvestInterval: 60,
    maxAllowedDeposit: hre.ethers.constants.MaxUint256,
    owner: "0x240c439011770253A379e4Fcd391761071C06bfb", //One set in the original smart contract
  };

  const encodedData = ethers.utils.defaultAbiCoder.encode(
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
      initParams.rewardToken, //
      0, //
      initParams.lpToken, //
      initParams.startBlock,
      initParams.endBlock,
      parseEther("0.25"), // 25% APR
      initParams.harvestInterval, //
      initParams.owner, //
      initParams.withdrawalFeeBP, //
      initParams.owner, //
      "https://cryption-network-local.infura-ipfs.io/ipfs/QmbCguTQzatdB3ebFVBq43B36g24e1DTSvPqw6YEpRG1ug", //
      "https://cryption-network-local.infura-ipfs.io/ipfs/QmYcftrjFV4qRGixg8FZekc4siPndaQyYX1oJoJ1U9ie2g", //
      ethers.constants.AddressZero, //
      initParams.endBlock,
      initParams.maxAllowedDeposit, //
    ]
  );

  const StakingPoolUpdatableFixedAPR = await hre.ethers.getContractFactory(
    "StakingPoolUpdatableFixedAPR"
  );
  const stakingPoolUpdateableFixedAPRInstance = await StakingPoolUpdatableFixedAPR.deploy(
    encodedData
  );

  console.log(
    "StakingPoolUpdatableFixedAPR address ",
    stakingPoolUpdateableFixedAPRInstance.address
  );

  await sleep(20000);

  await hre.run("verify:verify", {
    address: stakingPoolUpdateableFixedAPRInstance.address,
    constructorArguments: [encodedData],
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
