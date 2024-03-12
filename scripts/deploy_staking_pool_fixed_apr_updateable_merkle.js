// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat");
const keccak256 = require("keccak256");
const { MerkleTree } = require("merkletreejs");

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function hashToken(account) {
  const hashedValue = Buffer.from(
    ethers.utils.solidityKeccak256(["address"], [account]).slice(2),
    "hex"
  );
  return hashedValue;
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

  const hashData = [hashToken(initParams.owner)];

  const merkleTree = new MerkleTree(hashData, keccak256, { sortPairs: true });

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
      "0xce227ade24c76330c347342b8ed8323f4375b0b7948d2bb13fec8cabab4b1cf5", //Current Merkel Root so all addresses get automaitcally whitelisted
      initParams.maxAllowedDeposit, //
    ]
  );

  const StakingPoolUpdatableFixedAPRWhitelisting = await hre.ethers.getContractFactory(
    "StakingPoolUpdatableFixedAPRWhitelisting"
  );
  const stakingPoolFixedAPRMerkleWhitelistingInstance = await StakingPoolUpdatableFixedAPRWhitelisting.deploy(
    encodedData
  );

  console.log(
    "StakingPoolUpdatableFixedAPRWhitelisting address ",
    stakingPoolFixedAPRMerkleWhitelistingInstance.address
  );

  await sleep(20000);

  await hre.run("verify:verify", {
    address: stakingPoolFixedAPRMerkleWhitelistingInstance.address,
    constructorArguments: [encodedData],
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
