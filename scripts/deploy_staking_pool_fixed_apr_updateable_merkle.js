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
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // We get the contract to deploy
  const StakingPoolUpdatableFixedAPRWhitelisting = await hre.ethers.getContractFactory("StakingPoolUpdatableFixedAPRWhitelisting");
  const stakingPoolFixedAPRMerkleWhitelistingInstance = await StakingPoolUpdatableFixedAPRWhitelisting.deploy();

  console.log('StakingPoolUpdatableFixedAPRWhitelisting address ', stakingPoolFixedAPRMerkleWhitelistingInstance.address);

  await sleep(20000);

  await hre.run("verify:verify", {
    address: stakingPoolFixedAPRMerkleWhitelistingInstance.address,
    constructorArguments: [
    ],
  });

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
