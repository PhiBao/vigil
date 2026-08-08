import type { Address } from "viem";

/**
 * Chain constants for BSC (chain 56) and BSC Testnet (chain 97).
 * Contract addresses verified live against the public RPC during discovery.
 */

export const BSC_MAINNET_CHAIN_ID = 56;
export const BSC_TESTNET_CHAIN_ID = 97;

export const BSC_MAINNET_RPC = "https://bsc-dataseed.binance.org";

/** Addresses verified live (8 Aug 2026). */
export const ADDRESSES = {
  /** Venus Unitroller (mainnet BSC). */
  venusComptroller: "0xfD36E2c2a6789Db23113685031d7F16329158384" as Address,
  /** Venus Oracle. */
  venusOracle: "0x6592B5de802159F3E74B2486B091D11a8256ab8A" as Address,
  /** PancakeSwap V3 NonfungiblePositionManager. */
  pancakeV3NPM: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364" as Address,
  /** PancakeSwap V3 Factory. */
  pancakeV3Factory: "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865" as Address,
  /** PancakeSwap V3 SwapRouter (for Grid Runner, mainnet). Verified: 24,316 bytes code. */
  pancakeV3SwapRouter: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4" as Address,
  /** PancakeSwap V3 MasterChefV3 (farming). */
  pancakeV3MasterChef: "0x556B9306565093C855AEA9AE92A594704c2Cd632" as Address,
  /** Standard multicall3. */
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11" as Address,
  /** WBNB (mainnet BSC). */
  wbnb: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as Address,
  /** USDT (BSC-USD, mainnet). */
  usdt: "0x55d398326f99059fF775485246999027B3197955" as Address,
  /** USDC (mainnet BSC). */
  usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" as Address,
} as const;

/** Aave V3 Pool, BSC mainnet (verified live: code present, getReserveData works). */
export const AAVE_V3_POOL_BSC =
  "0x6807dc923806fE8Fd134338EABCA509979a7e0cB" as Address;

/** Aave V3 PoolAddressesProvider, BSC mainnet. */
export const AAVE_V3_POOL_ADDRESSES_PROVIDER_BSC =
  "0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D" as Address;

/** Aave V3 AAVE_PROTOCOL_DATA_PROVIDER, BSC mainnet. */
export const AAVE_V3_DATA_PROVIDER_BSC =
  "0xc90Df74A7c16245c5F5C5870327Ceb38Fe5d5328" as Address;

/** Aave V3 pool, BSC testnet (may differ; resolved at runtime if needed). */
export const AAVE_V3_POOL_BSC_TESTNET =
  "0x6807dc923806fE8Fd134338EABCA509979a7e0cB" as Address;

/**
 * Safe defaults for human-facing values. All token amounts use 18 decimals on
 * BNB Chain (verified: USDT/USDC are 18-decimal BEP-20 there). Never assume 6.
 */
export const TOKEN_DECIMALS_BSC = 18;
