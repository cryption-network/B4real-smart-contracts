// SPDX-License-Identifier: MIT

// File contracts/StakingPoolFixedAPR.sol
pragma solidity 0.7.6;

import "./library/IPolydexPair.sol";
import "./library/TransferHelper.sol";
import "./library/Ownable.sol";
import "./Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * It provides fixed APR returns for the deposited amount.
 */
contract StakingPoolFixedAPR is
    Ownable,
    ReentrancyGuard,
    Metadata
{
    using SafeMath for uint256;
    using SafeMath for uint16;
    using SafeERC20 for IERC20;

    /// @notice information stuct on each user than stakes LP tokens.
    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided.
        uint256 nextHarvestUntil; // When can the user harvest again.
        mapping(address => bool) whiteListedHandlers;
        mapping(IERC20 => uint256) lastDepositTimestamp;
        mapping(IERC20 => uint256) rewardCalculated;
    }

    // Info of each pool.
    struct RewardInfo {
        uint256 startTimestamp;
        uint256 endTimestamp;
        uint256 lastRewardBlockTimestamp; // Last block timestamp that rewards distribution occurs.
        IERC20 rewardToken; // Address of reward token contract.
    }

    /// @notice all the settings for this farm in one struct
    struct FarmInfo {
        uint256 numFarmers;
        uint256 harvestInterval; // Harvest interval in seconds
        IERC20 inputToken;
        uint16 withdrawalFeeBP; // Deposit fee in basis points
        uint256 endTimestamp;
    }

    // Deposit Fee address
    address public feeAddress;
    // Max harvest interval: 14 days.
    uint256 public constant MAXIMUM_HARVEST_INTERVAL = 14 days;
    uint256 public constant MAXIMUM_APR = 10000;
    uint256 public constant YEARLY_SECONDS = 365 * 86400;

    // Max withdrawal fee: 10%. This number is later divided by 10000 for calculations.
    uint16 public constant MAXIMUM_WITHDRAWAL_FEE_BP = 1000;

    uint256 public totalInputTokensStaked;
    uint256 public expectedAPR;
    uint256 public expectedAPRNormalized;

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
    event RewardTokenURLUpdated(string _url, uint256 _rewardPoolIndex);
    event WithdrawalFeeChanged(uint16 _withdrawalFee);
    event HarvestIntervalChanged(uint256 _harvestInterval);
    event MaxAllowedDepositUpdated(uint256 _maxAllowedDeposit);

    struct LocalVars {
        uint256 _amount;
        uint256 _startTimestamp;
        uint256 _endTimestamp;
        uint256 _rewardPerSecond;
        IERC20 _rewardToken;
    }

    LocalVars private _localVars;

    /**
     * @notice initialize the staking pool contract.
     * This is called only once and state is initialized.
     */
    function init(bytes memory extraData) external {
        require(initialized == false, "Contract already initialized");

        // Decoding is done in two parts due to stack too deep issue.
        (
            _localVars._rewardToken,
            farmInfo.inputToken,
            _localVars._startTimestamp,
            _localVars._endTimestamp,
            _localVars._amount
        ) = abi.decode(extraData, (IERC20, IERC20, uint256, uint256, uint256));

        string memory _rewardTokenUrl;
        (
            ,
            ,
            ,
            ,
            ,
            _localVars._rewardPerSecond,
            farmInfo.harvestInterval,
            feeAddress,
            farmInfo.withdrawalFeeBP,
            owner
        ) = abi.decode(
            extraData,
            (
                IERC20,
                IERC20,
                uint256,
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
            maxAllowedDeposit,
            expectedAPR
        ) = abi.decode(
            extraData,
            (
                IERC20,
                IERC20,
                uint256,
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
                uint256,
                uint256
            )
        );

        updateMeta(address(farmInfo.inputToken), routerAddress, inputTokenUrl);
        updateMeta(
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
                    : _localVars._startTimestamp
            })
        );

        expectedAPRNormalized = (expectedAPR.mul(1e18)).div(MAXIMUM_APR);

        activeRewardTokens[address(_localVars._rewardToken)] = true;
        initialized = true;
    }

    /**
     * @notice Gets the reward multiplier over the given _from_timestamp _toTimestamp
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

    function updateMaxAllowedDeposit(uint256 _maxAllowedDeposit)
        external
        onlyOwner
    {
        maxAllowedDeposit = _maxAllowedDeposit;
        emit MaxAllowedDepositUpdated(_maxAllowedDeposit);
    }

    function updateRewardTokenURL(uint256 _rewardTokenIndex, string memory _url)
        external
        onlyOwner
    {
        RewardInfo storage rewardInfo = rewardPool[_rewardTokenIndex];
        updateMetaURL(address(rewardInfo.rewardToken), _url);
        emit RewardTokenURLUpdated(_url, _rewardTokenIndex);
    }

    function updateWithdrawalFee(uint16 _withdrawalFee) external onlyOwner {
        require(
            _withdrawalFee <= MAXIMUM_WITHDRAWAL_FEE_BP,
            "invalid withdrawal fee basis points"
        );

        farmInfo.withdrawalFeeBP = _withdrawalFee;
        emit WithdrawalFeeChanged(_withdrawalFee);
    }

    function updateHarvestInterval(uint256 _harvestInterval)
        external
        onlyOwner
    {
        require(
            _harvestInterval <= MAXIMUM_HARVEST_INTERVAL,
            "invalid harvest intervals"
        );

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
        string memory _tokenUrl
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

        rewardPool.push(
            RewardInfo({
                startTimestamp: _startTimestamp,
                endTimestamp: _endTimestamp,
                rewardToken: _rewardToken,
                lastRewardBlockTimestamp: _lastRewardTimestamp
            })
        );

        activeRewardTokens[address(_rewardToken)] = true;

        TransferHelper.safeTransferFrom(
            address(_rewardToken),
            msg.sender,
            address(this),
            _amount
        );

        updateMeta(address(_rewardToken), address(0), _tokenUrl);

        emit RewardTokenAdded(_rewardToken);
    }

    /**
     * @notice function to see accumulated balance of reward token for specified user
     * @param _user the user for whom unclaimed tokens will be shown
     * @return total amount of withdrawable reward tokens
     */
    function pendingReward(address _user, uint256 _rewardInfoIndex)
        public
        view
        returns (uint256)
    {
        UserInfo storage user = userInfo[_user];
        RewardInfo memory rewardInfo = rewardPool[_rewardInfoIndex];
        uint256 lpSupply = totalInputTokensStaked;
        uint256 tokenReward;

        if (
            block.timestamp >
            user.lastDepositTimestamp[rewardInfo.rewardToken] &&
            lpSupply != 0
        ) {
            uint256 multiplier = getMultiplier(
                user.lastDepositTimestamp[rewardInfo.rewardToken],
                _rewardInfoIndex,
                block.timestamp
            );

            tokenReward = calculateRewardPerSec(user.amount, multiplier);
        }

        return user.rewardCalculated[rewardInfo.rewardToken].add(tokenReward);
    }

    function calculateRewardPerSec(uint256 _amount, uint256 _diffTime)
        public
        view
        returns (uint256)
    {
        // 30% APR. Calculating rewards per year
        // amount = 1000
        // perSec = amount * ( 30/100) / (365 * 86400)
        //      = 0.000009512937595129377

        // Accumulated rewards = perSec * (365 * 86400)
        //                     = 300
        uint256 perSecReward = (_amount.mul(expectedAPRNormalized)) /
            YEARLY_SECONDS;

        return perSecReward.mul(_diffTime).div(1e18);
    }

    // View function to see if user can harvest tokens.
    function canHarvest(address _user) public view returns (bool) {
        UserInfo storage user = userInfo[_user];
        return block.timestamp >= user.nextHarvestUntil;
    }

    // View function to see if user harvest until time.
    function getHarvestUntil(address _user) external view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        return user.nextHarvestUntil;
    }

    function deposit(uint256 _amount) external nonReentrant {
        _deposit(_amount, msg.sender);
    }

    function depositFor(uint256 _amount, address _user) external nonReentrant {
        _deposit(_amount, _user);
    }

    function _deposit(uint256 _amount, address _user) internal {
        require(
            totalInputTokensStaked.add(_amount) <= maxAllowedDeposit,
            "Max allowed deposit exceeded"
        );
        UserInfo storage user = userInfo[_user];
        user.whiteListedHandlers[_user] = true;
        payOrLockupPendingReward(_user, _user, true);
        if (_amount > 0) {
            if (user.amount == 0) {
                farmInfo.numFarmers++;
            }
            farmInfo.inputToken.safeTransferFrom(
                address(msg.sender),
                address(this),
                _amount
            );
            user.amount = user.amount.add(_amount);
        }
        totalInputTokensStaked = totalInputTokensStaked.add(_amount);

        emit Deposit(_user, _amount);
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

    function _withdraw(
        uint256 _amount,
        address _user,
        address _withdrawer
    ) internal {
        UserInfo storage user = userInfo[_user];
        require(user.amount >= _amount, "INSUFFICIENT");
        payOrLockupPendingReward(_user, _withdrawer, false);
        if (user.amount == _amount && _amount > 0) {
            farmInfo.numFarmers--;
        }

        if (_amount > 0) {
            user.amount = user.amount.sub(_amount);
            if (farmInfo.withdrawalFeeBP > 0) {
                uint256 withdrawalFee = _amount
                    .mul(farmInfo.withdrawalFeeBP)
                    .div(10000);
                farmInfo.inputToken.safeTransfer(feeAddress, withdrawalFee);
                farmInfo.inputToken.safeTransfer(
                    address(_withdrawer),
                    _amount.sub(withdrawalFee)
                );
            } else {
                farmInfo.inputToken.safeTransfer(address(_withdrawer), _amount);
            }
        }
        totalInputTokensStaked = totalInputTokensStaked.sub(_amount);
        emit Withdraw(_user, _amount);
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
        user.amount = 0;

        uint256 totalRewardPools = rewardPool.length;
        for (uint256 i = 0; i < totalRewardPools; i++) {
            user.rewardCalculated[rewardPool[i].rewardToken] = 0;
        }
        farmInfo.inputToken.safeTransfer(address(msg.sender), user.amount);
        emit EmergencyWithdraw(msg.sender, user.amount);
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

    function isUserWhiteListed(address _owner, address _user)
        external
        view
        returns (bool)
    {
        UserInfo storage user = userInfo[_owner];
        return user.whiteListedHandlers[_user];
    }

    function payOrLockupPendingReward(
        address _user,
        address _withdrawer,
        bool _action
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

            uint256 userRewards = user.rewardCalculated[rewardInfo.rewardToken];

            uint256 pendingRewardCalculated = pendingReward(msg.sender, i);
            if (canUserHarvest) {
                // if _action is true, then deposit is called
                if (_action) {
                    user.lastDepositTimestamp[rewardInfo.rewardToken] = block
                        .timestamp;
                }
                if (pendingRewardCalculated > 0 || userRewards > 0) {
                    uint256 totalRewards = pendingRewardCalculated.add(
                        userRewards
                    );
                    // reset lockup
                    totalLockedUpRewards[
                        rewardInfo.rewardToken
                    ] = totalLockedUpRewards[rewardInfo.rewardToken].sub(
                        userRewards
                    );
                    user.rewardCalculated[rewardInfo.rewardToken] = 0;
                    user.nextHarvestUntil = block.timestamp.add(
                        farmInfo.harvestInterval
                    );

                    // send rewards
                    TransferHelper.safeTransfer(
                        address(rewardInfo.rewardToken),
                        _withdrawer,
                        totalRewards
                    );
                }
            } else if (pendingRewardCalculated > 0) {
                user.rewardCalculated[rewardInfo.rewardToken] = user
                    .rewardCalculated[rewardInfo.rewardToken]
                    .add(pendingRewardCalculated);
                totalLockedUpRewards[
                    rewardInfo.rewardToken
                ] = totalLockedUpRewards[rewardInfo.rewardToken].add(
                    pendingRewardCalculated
                );
                emit RewardLockedUp(_user, pendingRewardCalculated);
            }
        }
    }

    // Update fee address by the previous fee address.
    function setFeeAddress(address _feeAddress) external onlyOwner {
        require(_feeAddress != address(0), "setFeeAddress: invalid address");
        feeAddress = _feeAddress;
        emit FeeAddressChanged(feeAddress);
    }

    function transferRewardToken(uint256 _rewardTokenIndex, uint256 _amount)
        external
        onlyOwner
    {
        RewardInfo storage rewardInfo = rewardPool[_rewardTokenIndex];

        TransferHelper.safeTransfer(
            address(rewardInfo.rewardToken),
            msg.sender,
            _amount
        );
    }
}
