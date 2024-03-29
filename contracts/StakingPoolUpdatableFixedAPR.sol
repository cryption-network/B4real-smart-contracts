// SPDX-License-Identifier: MIT

// File contracts/StakingPool.sol
pragma solidity 0.7.6;

import "./library/TransferHelper.sol";
import "./library/Ownable.sol";
import "./Metadata.sol";
import "./IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract StakingPoolUpdatableFixedAPR is Ownable, ReentrancyGuard, Metadata {
    using SafeMath for uint256;
    using SafeMath for uint16;
    using Address for address;

    /// @notice information stuct on each user than stakes LP tokens.
    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided.
        uint256 nextHarvestUntil; // When can the user harvest again.
        mapping(IERC20 => uint256) rewardDebt; // Reward debt.
        mapping(IERC20 => uint256) rewardLockedUp; // Reward locked up.
        mapping(address => bool) whiteListedHandlers;
    }

    // Info of each pool.
    struct RewardInfo {
        uint256 startTimestamp;
        uint256 endTimestamp;
        uint256 accRewardPerShare;
        uint256 lastRewardBlockTimestamp; // Last block timestamp that rewards distribution occurs.
        uint256 blockRewardPerSec;
        IERC20 rewardToken; // Address of reward token contract.
        uint256 expectedAPR; // if target APR is 20%, then expectedAPR =  ( 20 / 100 ) * 1e18. Percentage APR is scaled up by e18.
    }

    /// @notice all the settings for this farm in one struct
    struct FarmInfo {
        uint256 numFarmers;
        uint256 harvestInterval; // Harvest interval in seconds
        IERC20 inputToken;
        uint16 withdrawalFeeBP; // Withdrawal fee in basis points
        uint256 endTimestamp;
    }

    // Withdrawal Fee address
    address public feeAddress;
    // Max harvest interval: 14 days.
    uint256 public constant MAXIMUM_HARVEST_INTERVAL = 14 days;
    uint256 public constant SECONDS_IN_YEAR = 365 * 86400;

    // Max withdrawal fee: 10%. This number is later divided by 10000 for calculations.
    uint16 public constant MAXIMUM_WITHDRAWAL_FEE_BP = 1000;

    uint256 public totalInputTokensStaked;
    uint256 public exponent = 1e9;

    // Total locked up rewards
    mapping(IERC20 => uint256) public totalLockedUpRewards;

    FarmInfo public farmInfo;

    mapping(address => bool) public activeRewardTokens;

    /// @notice information on each user than stakes LP tokens
    mapping(address => UserInfo) public userInfo;

    RewardInfo[] public rewardPool;

    bool public initialized;

    uint256 public maxAllowedDeposit;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 amount);
    event RewardLockedUp(address indexed user, uint256 amountLockedUp);
    event RewardTokenAdded(IERC20 _rewardToken);
    event FeeAddressChanged(address _feeAddress);
    event RewardPoolUpdated(uint256 _rewardInfoIndex);
    event UserWhitelisted(address _primaryUser, address _whitelistedUser);
    event UserBlacklisted(address _primaryUser, address _blacklistedUser);
    event ExpectedAprUpdated(uint256 _expectedApr, uint256 _rewardPoolIndex);
    event RewardTokenURLUpdated(string _url, uint256 _rewardPoolIndex);
    event WithdrawalFeeChanged(uint16 _withdrawalFee);
    event HarvestIntervalChanged(uint256 _harvestInterval);
    event MaxAllowedDepositUpdated(uint256 _maxAllowedDeposit);

    struct LocalVars {
        uint256 _amount;
        uint256 _startTimestamp;
        uint256 _endTimestamp;
        IERC20 _rewardToken;
    }

    LocalVars private _localVars;

    constructor(bytes memory _poolData) {
        _initPool(_poolData);
    }

    /**
     * @notice initialize the staking pool contract.
     * This is called only once and state is initialized.
     */
    function _initPool(bytes memory extraData) internal {
        require(initialized == false, "Contract already initialized");

        // Decoding is done in two parts due to stack too deep issue.
        (
            _localVars._rewardToken,
            _localVars._amount,
            farmInfo.inputToken,
            _localVars._startTimestamp,
            _localVars._endTimestamp
        ) = abi.decode(extraData, (IERC20, uint256, IERC20, uint256, uint256));

        uint256 expectedAPR;
        string memory _rewardTokenUrl;
        (
            ,
            ,
            ,
            ,
            ,
            expectedAPR,
            farmInfo.harvestInterval,
            feeAddress,
            farmInfo.withdrawalFeeBP,
            owner
        ) = abi.decode(
            extraData,
            (
                IERC20,
                uint256,
                IERC20,
                uint256,
                uint256,
                uint256,
                uint256,
                address,
                uint16,
                address
            )
        );
        address routerAddress;
        string memory inputTokenUrl;

        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            _rewardTokenUrl,
            inputTokenUrl,
            routerAddress,
            farmInfo.endTimestamp,
            maxAllowedDeposit
        ) = abi.decode(
            extraData,
            (
                IERC20,
                uint256,
                IERC20,
                uint256,
                uint256,
                uint256,
                uint256,
                address,
                uint16,
                address,
                string,
                string,
                address,
                uint256,
                uint256
            )
        );

        _initMetaOwner(owner);
        _updateMeta(address(farmInfo.inputToken), routerAddress, inputTokenUrl);
        _updateMeta(
            address(_localVars._rewardToken),
            address(0),
            _rewardTokenUrl
        );

        require(
            farmInfo.withdrawalFeeBP <= MAXIMUM_WITHDRAWAL_FEE_BP,
            "add: invalid withdrawal fee basis points"
        );
        require(
            farmInfo.harvestInterval <= MAXIMUM_HARVEST_INTERVAL,
            "add: invalid harvest interval"
        );

        TransferHelper.safeTransferFrom(
            address(_localVars._rewardToken),
            msg.sender,
            address(this),
            _localVars._amount
        );

        require(
            farmInfo.endTimestamp >= block.timestamp,
            "End block timestamp must be greater than current timestamp"
        );
        require(
            farmInfo.endTimestamp > _localVars._startTimestamp,
            "Invalid start timestamp"
        );
        require(
            farmInfo.endTimestamp >= _localVars._endTimestamp,
            "Invalid end timestamp"
        );
        require(
            _localVars._endTimestamp > _localVars._startTimestamp,
            "Invalid start and end timestamp"
        );

        rewardPool.push(
            RewardInfo({
                startTimestamp: _localVars._startTimestamp,
                endTimestamp: _localVars._endTimestamp,
                rewardToken: _localVars._rewardToken,
                lastRewardBlockTimestamp: block.timestamp >
                    _localVars._startTimestamp
                    ? block.timestamp
                    : _localVars._startTimestamp,
                blockRewardPerSec: 0,
                accRewardPerShare: 0,
                expectedAPR: expectedAPR
            })
        );

        activeRewardTokens[address(_localVars._rewardToken)] = true;
        initialized = true;
    }

    function updateMaxAllowedDeposit(
        uint256 _maxAllowedDeposit
    ) external onlyOwner {
        maxAllowedDeposit = _maxAllowedDeposit;
        emit MaxAllowedDepositUpdated(_maxAllowedDeposit);
    }

    function updateWithdrawalFee(
        uint16 _withdrawalFee,
        bool _massUpdate
    ) external onlyOwner {
        require(
            _withdrawalFee <= MAXIMUM_WITHDRAWAL_FEE_BP,
            "invalid withdrawal fee basis points"
        );

        if (_massUpdate) {
            massUpdatePools();
        }

        farmInfo.withdrawalFeeBP = _withdrawalFee;
        emit WithdrawalFeeChanged(_withdrawalFee);
    }

    function updateHarvestInterval(
        uint256 _harvestInterval,
        bool _massUpdate
    ) external onlyOwner {
        require(
            _harvestInterval <= MAXIMUM_HARVEST_INTERVAL,
            "invalid harvest intervals"
        );

        if (_massUpdate) {
            massUpdatePools();
        }

        farmInfo.harvestInterval = _harvestInterval;
        emit HarvestIntervalChanged(_harvestInterval);
    }

    function rescueFunds(IERC20 _token, address _recipient) external onlyOwner {
        TransferHelper.safeTransfer(
            address(_token),
            _recipient,
            _token.balanceOf(address(this))
        );
    }

    function addRewardToken(
        uint256 _startTimestamp,
        uint256 _endTimestamp,
        IERC20 _rewardToken, // Address of reward token contract.
        uint256 _lastRewardTimestamp,
        uint256 _amount,
        string memory _tokenUrl,
        bool _massUpdate,
        uint256 _expectedAPR
    ) external onlyOwner nonReentrant {
        require(
            farmInfo.endTimestamp > _startTimestamp,
            "Invalid start end timestamp"
        );
        require(
            farmInfo.endTimestamp >= _endTimestamp,
            "Invalid end timestamp"
        );
        require(_endTimestamp > _startTimestamp, "Invalid end timestamp");
        require(address(_rewardToken) != address(0), "Invalid reward token");
        require(
            activeRewardTokens[address(_rewardToken)] == false,
            "Reward Token already added"
        );

        require(
            _lastRewardTimestamp >= block.timestamp,
            "Last RewardBlock must be greater than currentBlock"
        );

        if (_massUpdate) {
            massUpdatePools();
        }

        rewardPool.push(
            RewardInfo({
                startTimestamp: _startTimestamp,
                endTimestamp: _endTimestamp,
                rewardToken: _rewardToken,
                lastRewardBlockTimestamp: _lastRewardTimestamp,
                blockRewardPerSec: 0,
                accRewardPerShare: 0,
                expectedAPR: _expectedAPR
            })
        );

        activeRewardTokens[address(_rewardToken)] = true;

        TransferHelper.safeTransferFrom(
            address(_rewardToken),
            msg.sender,
            address(this),
            _amount
        );

        _updateMeta(address(_rewardToken), address(0), _tokenUrl);
        _updateRewardPerSecond();
        emit RewardTokenAdded(_rewardToken);
    }

    function deposit(uint256 _amount) external nonReentrant {
        _deposit(_amount, msg.sender);
    }

    function depositFor(uint256 _amount, address _user) external nonReentrant {
        _deposit(_amount, _user);
    }

    /**
     * @notice withdraw LP token function for msg.sender
     * @param _amount the total withdrawable amount
     */
    function withdraw(uint256 _amount) external nonReentrant {
        _withdraw(_amount, msg.sender, msg.sender);
    }

    function withdrawFor(uint256 _amount, address _user) external nonReentrant {
        UserInfo storage user = userInfo[_user];
        require(
            user.whiteListedHandlers[msg.sender],
            "Handler not whitelisted to withdraw"
        );
        _withdraw(_amount, _user, msg.sender);
    }

    /**
     * @notice emergency function to withdraw LP tokens and forego harvest rewards. Important to protect users LP tokens
     */
    function emergencyWithdraw() external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];

        if (user.amount > 0) {
            farmInfo.numFarmers--;
        }
        totalInputTokensStaked = totalInputTokensStaked.sub(user.amount);
        uint256 amount = user.amount;
        user.amount = 0;

        uint256 totalRewardPools = rewardPool.length;
        for (uint256 i = 0; i < totalRewardPools; i++) {
            user.rewardDebt[rewardPool[i].rewardToken] = 0;
            totalLockedUpRewards[
                rewardPool[i].rewardToken
            ] = totalLockedUpRewards[rewardPool[i].rewardToken].sub(
                user.rewardLockedUp[rewardPool[i].rewardToken]
            );
            user.rewardLockedUp[rewardPool[i].rewardToken] = 0;
        }
        _updateRewardPerSecond();
        TransferHelper.safeTransfer(
            address(farmInfo.inputToken),
            address(msg.sender),
            amount
        );
        emit EmergencyWithdraw(msg.sender, amount);
    }

    function whitelistHandler(address _handler) external {
        UserInfo storage user = userInfo[msg.sender];
        user.whiteListedHandlers[_handler] = true;
        emit UserWhitelisted(msg.sender, _handler);
    }

    function removeWhitelistedHandler(address _handler) external {
        UserInfo storage user = userInfo[msg.sender];
        user.whiteListedHandlers[_handler] = false;
        emit UserBlacklisted(msg.sender, _handler);
    }

    // Update fee address by the previous fee address.
    function setFeeAddress(address _feeAddress) external onlyOwner {
        require(_feeAddress != address(0), "setFeeAddress: invalid address");
        feeAddress = _feeAddress;
        emit FeeAddressChanged(feeAddress);
    }

    function updateExpectedAPR(
        uint256 _expectedAPR,
        uint256 _rewardTokenIndex
    ) external onlyOwner {
        massUpdatePools();
        RewardInfo storage reward = rewardPool[_rewardTokenIndex];
        reward.expectedAPR = _expectedAPR;
        _updateRewardPerSecond();
        emit ExpectedAprUpdated(_expectedAPR, _rewardTokenIndex);
    }

    function transferRewardToken(
        uint256 _rewardTokenIndex,
        uint256 _amount
    ) external onlyOwner {
        RewardInfo storage rewardInfo = rewardPool[_rewardTokenIndex];
        require(
            rewardInfo.rewardToken.balanceOf(address(this)) >= _amount,
            "Insufficient reward token balance"
        );

        TransferHelper.safeTransfer(
            address(rewardInfo.rewardToken),
            msg.sender,
            _amount
        );
    }

    /**
     * @notice function to see accumulated balance of reward token for specified user
     * @param _user the user for whom unclaimed tokens will be shown
     * @param _rewardInfoIndex reward token's index.
     * @return total amount of withdrawable reward tokens
     */
    function pendingReward(
        address _user,
        uint256 _rewardInfoIndex
    ) external view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        RewardInfo memory rewardInfo = rewardPool[_rewardInfoIndex];
        uint256 accRewardPerShare = rewardInfo.accRewardPerShare;
        uint256 lpSupply = totalInputTokensStaked;

        if (
            block.timestamp > rewardInfo.lastRewardBlockTimestamp &&
            lpSupply != 0
        ) {
            uint256 multiplier = getMultiplier(
                rewardInfo.lastRewardBlockTimestamp,
                _rewardInfoIndex,
                block.timestamp
            );
            uint256 tokenReward = multiplier.mul(rewardInfo.blockRewardPerSec);
            accRewardPerShare = accRewardPerShare.add(
                tokenReward.div(lpSupply)
            );
        }

        uint256 pending = user.amount.mul(accRewardPerShare).div(exponent).sub(
            user.rewardDebt[rewardInfo.rewardToken]
        );
        return pending.add(user.rewardLockedUp[rewardInfo.rewardToken]);
    }

    function isUserWhiteListed(
        address _owner,
        address _user
    ) external view returns (bool) {
        UserInfo storage user = userInfo[_owner];
        return user.whiteListedHandlers[_user];
    }

    // View function to see if user harvest until time.
    function getHarvestUntil(address _user) external view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        return user.nextHarvestUntil;
    }

    /**
     * @notice updates pool information to be up to date to the current block timestamp
     */
    function updatePool(uint256 _rewardInfoIndex) public {
        RewardInfo storage rewardInfo = rewardPool[_rewardInfoIndex];
        if (block.timestamp <= rewardInfo.lastRewardBlockTimestamp) {
            return;
        }
        uint256 lpSupply = totalInputTokensStaked;

        if (lpSupply == 0) {
            rewardInfo.lastRewardBlockTimestamp = block.timestamp;
            return;
        }
        uint256 multiplier = getMultiplier(
            rewardInfo.lastRewardBlockTimestamp,
            _rewardInfoIndex,
            block.timestamp
        );
        uint256 tokenReward = multiplier.mul(rewardInfo.blockRewardPerSec);
        rewardInfo.accRewardPerShare = rewardInfo.accRewardPerShare.add(
            tokenReward.div(lpSupply)
        );
        rewardInfo.lastRewardBlockTimestamp = block.timestamp <
            rewardInfo.endTimestamp
            ? block.timestamp
            : rewardInfo.endTimestamp;

        emit RewardPoolUpdated(_rewardInfoIndex);
    }

    function massUpdatePools() public {
        uint256 totalRewardPool = rewardPool.length;
        for (uint256 i = 0; i < totalRewardPool; i++) {
            updatePool(i);
        }
    }

    /**
     * @notice Gets the reward multiplier over the given _fromTimestamp until _toTimestamp
     * @param _fromTimestamp the start of the period to measure rewards for
     * @param _rewardInfoIndex RewardPool Id number
     * @param _toTimestamp the end of the period to measure rewards for
     * @return The weighted multiplier for the given period
     */
    function getMultiplier(
        uint256 _fromTimestamp,
        uint256 _rewardInfoIndex,
        uint256 _toTimestamp
    ) public view returns (uint256) {
        RewardInfo memory rewardInfo = rewardPool[_rewardInfoIndex];
        uint256 _from = _fromTimestamp >= rewardInfo.startTimestamp
            ? _fromTimestamp
            : rewardInfo.startTimestamp;
        uint256 to = rewardInfo.endTimestamp > _toTimestamp
            ? _toTimestamp
            : rewardInfo.endTimestamp;
        if (_from > to) {
            return 0;
        }

        return to.sub(_from, "from getMultiplier");
    }

    // View function to see if user can harvest tokens.
    function canHarvest(address _user) public view returns (bool) {
        UserInfo storage user = userInfo[_user];
        return ((block.timestamp >= user.nextHarvestUntil));
    }

    function _updateRewardPerSecond() internal {
        /* 
            APR = ( SECONDS_IN_YEAR * RewardPerSecond * 100 ) / Total deposited
            RewardPerSecond = ( APR * Total deposited ) / ( SECONDS_IN_YEAR )
        */
        uint256 totalRewardPools = rewardPool.length;
        uint256 inputTokenDecimals = farmInfo.inputToken.decimals();

        for (uint256 i = 0; i < totalRewardPools; i++) {
            RewardInfo storage rewardInfo = rewardPool[i];
            uint256 rewardTokenDecimals = rewardInfo.rewardToken.decimals();
            uint256 expectedAPR = rewardInfo.expectedAPR;
            uint256 effectiveRewardPerSecond = (
                expectedAPR
                    .mul(totalInputTokensStaked)
                    .mul(10 ** rewardTokenDecimals)
                    .mul(exponent)
            ).div((10 ** inputTokenDecimals).mul(SECONDS_IN_YEAR * 1e18));
            rewardInfo.blockRewardPerSec = effectiveRewardPerSecond;
        }
    }

    function _deposit(uint256 _amount, address _user) internal {
        require(
            totalInputTokensStaked.add(_amount) <= maxAllowedDeposit,
            "Max allowed deposit exceeded"
        );
        UserInfo storage user = userInfo[_user];
        payOrLockupPendingReward(_user, _user);
        if (user.amount == 0 && _amount > 0) {
            farmInfo.numFarmers++;
        }
        if (_amount > 0) {
            TransferHelper.safeTransferFrom(
                address(farmInfo.inputToken),
                address(msg.sender),
                address(this),
                _amount
            );
            user.amount = user.amount.add(_amount);
        }
        totalInputTokensStaked = totalInputTokensStaked.add(_amount);
        updateRewardDebt(_user);
        _updateRewardPerSecond();
        emit Deposit(_user, _amount);
    }

    function _withdraw(
        uint256 _amount,
        address _user,
        address _withdrawer
    ) internal {
        UserInfo storage user = userInfo[_user];
        require(user.amount >= _amount, "INSUFFICIENT");
        payOrLockupPendingReward(_user, _withdrawer);
        if (_amount > 0) {
            if (user.amount == _amount) {
                farmInfo.numFarmers--;
            }
            user.amount = user.amount.sub(_amount);
            if (farmInfo.withdrawalFeeBP > 0) {
                uint256 withdrawalFee = _amount
                    .mul(farmInfo.withdrawalFeeBP)
                    .div(10000);
                TransferHelper.safeTransfer(
                    address(farmInfo.inputToken),
                    feeAddress,
                    withdrawalFee
                );
                TransferHelper.safeTransfer(
                    address(farmInfo.inputToken),
                    address(_withdrawer),
                    _amount.sub(withdrawalFee)
                );
            } else {
                TransferHelper.safeTransfer(
                    address(farmInfo.inputToken),
                    address(_withdrawer),
                    _amount
                );
            }
        }
        totalInputTokensStaked = totalInputTokensStaked.sub(_amount);
        updateRewardDebt(_user);
        _updateRewardPerSecond();
        emit Withdraw(_user, _amount);
    }

    function payOrLockupPendingReward(
        address _user,
        address _withdrawer
    ) internal {
        UserInfo storage user = userInfo[_user];
        if (user.nextHarvestUntil == 0) {
            user.nextHarvestUntil = block.timestamp.add(
                farmInfo.harvestInterval
            );
        }

        bool canUserHarvest = canHarvest(_user);

        uint256 totalRewardPools = rewardPool.length;
        for (uint256 i = 0; i < totalRewardPools; i++) {
            RewardInfo storage rewardInfo = rewardPool[i];

            updatePool(i);

            uint256 userRewardDebt = user.rewardDebt[rewardInfo.rewardToken];
            uint256 userRewardLockedUp = user.rewardLockedUp[
                rewardInfo.rewardToken
            ];
            uint256 pending = user
                .amount
                .mul(rewardInfo.accRewardPerShare)
                .div(exponent)
                .sub(userRewardDebt);

            if (canUserHarvest) {
                if (pending > 0 || userRewardLockedUp > 0) {
                    uint256 totalRewards = pending.add(userRewardLockedUp);
                    // reset lockup
                    totalLockedUpRewards[
                        rewardInfo.rewardToken
                    ] = totalLockedUpRewards[rewardInfo.rewardToken].sub(
                        userRewardLockedUp
                    );
                    user.rewardLockedUp[rewardInfo.rewardToken] = 0;
                    user.nextHarvestUntil = block.timestamp.add(
                        farmInfo.harvestInterval
                    );
                    // send rewards
                    _safeRewardTransfer(
                        _withdrawer,
                        totalRewards,
                        rewardInfo.rewardToken
                    );
                }
            } else if (pending > 0) {
                user.rewardLockedUp[rewardInfo.rewardToken] = user
                    .rewardLockedUp[rewardInfo.rewardToken]
                    .add(pending);
                totalLockedUpRewards[
                    rewardInfo.rewardToken
                ] = totalLockedUpRewards[rewardInfo.rewardToken].add(pending);
                emit RewardLockedUp(_user, pending);
            }
        }
    }

    function updateRewardDebt(address _user) internal {
        UserInfo storage user = userInfo[_user];
        uint256 totalRewardPools = rewardPool.length;
        for (uint256 i = 0; i < totalRewardPools; i++) {
            RewardInfo storage rewardInfo = rewardPool[i];

            user.rewardDebt[rewardInfo.rewardToken] = user
                .amount
                .mul(rewardInfo.accRewardPerShare)
                .div(exponent);
        }
    }

    /**
     * @notice Safe reward transfer function, just in case a rounding error causes pool to not have enough reward tokens
     * @param _amount the total amount of tokens to transfer
     * @param _rewardToken token address for transferring tokens
     */
    function _safeRewardTransfer(
        address _to,
        uint256 _amount,
        IERC20 _rewardToken
    ) private {
        require(
            _rewardToken.balanceOf(address(this)) >= _amount,
            "Insufficient reward token balance"
        );
        TransferHelper.safeTransfer(address(_rewardToken), _to, _amount);
    }
}
