# fixed-apr-staking-pool

### Install dependencies
To install dependencies, run `npm i` on command line.

### Compiling Contracts
To compile contracts, first install dependencies. Run `npm run compile` on command line

### Deployment of contracts
Add `PRIVATE_KEY` and `ETHERSCAN_KEY` environment variables.
`PRIVATE_KEY` variable will be deployer address for smart contract deployment.
`ETHERSCAN_KEY` variable is used for smart contract verification on block explorer.

Deployment scripts of smart contracts can be found under `scripts` folder. Refer package json for deployement of contracts on mumbai matic testnet and polygon network.

### Run tests
To run test-case for StakingPoolFixedAPR contract, execute below on command line :
```
npx hardhat test test/testStakingFixedAPR.js
```

To run test-case for StakingPoolFixedAPRMerkleWhitelisting contract, execute below on command line :
```
npx hardhat test test/testStakingFixedAPRMerkleWhitelisting.js
```



    
