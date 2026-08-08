import { parseAbi } from "viem";

/**
 * Minimal ABIs — only the functions the scanner needs.
 * Selectors verified live against BSC mainnet (Aug 2026).
 */

export const comptrollerAbi = parseAbi([
  "function getAccountLiquidity(address account) external view returns (uint, uint, uint)",
  "function getAssetsIn(address account) external view returns (address[] memory)",
  "function oracle() external view returns (address)",
  "function markets(address vToken) external view returns (bool, uint, bool)",
  "function closeFactorMantissa() external view returns (uint)",
  "function liquidationIncentiveMantissa() external view returns (uint)",
] as const);

export const vTokenAbi = parseAbi([
  "function getAccountSnapshot(address account) external view returns (uint, uint, uint, uint)",
  "function borrowBalanceOf(address account) external view returns (uint)",
  "function balanceOf(address owner) external view returns (uint)",
  "function underlying() external view returns (address)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function totalSupply() external view returns (uint)",
] as const);

export const oracleAbi = parseAbi([
  "function getUnderlyingPrice(address vToken) external view returns (uint)",
  "function getUnderlyingPriceBySymbol(string calldata symbol) external view returns (uint)",
] as const);

export const aavePoolAbi = parseAbi([
  "function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
] as const);

export const aaveDataProviderAbi = parseAbi([
  "function getUserReserveData(address asset, address user) external view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)",
  "function getReserveTokensAddresses(address asset) external view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)",
] as const);

export const erc20Abi = parseAbi([
  "function balanceOf(address owner) external view returns (uint)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
  "function approve(address spender, uint256 amount) external returns (bool)",
] as const);

export const pcsV3NpmAbi = parseAbi([
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function balanceOf(address owner) external view returns (uint)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)",
  "function totalSupply() external view returns (uint)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
] as const);

export const pcsV3FactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address)",
] as const);

export const pcsV3PoolAbi = parseAbi([
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function tickSpacing() external view returns (int24)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function fee() external view returns (uint24)",
] as const);
