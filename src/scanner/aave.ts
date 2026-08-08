import type { Address } from "viem";
import { publicClient } from "../lib/rpc";
import { aavePoolAbi, aaveDataProviderAbi } from "./abis";
import { AAVE_V3_POOL_BSC, AAVE_V3_DATA_PROVIDER_BSC } from "../config";
import { fromBaseUnits } from "../lib/money";
import { logger } from "../lib/logger";

export interface AavePosition {
  symbol: string;
  asset: Address;
  suppliedTokens: number;
  borrowedTokens: number;
}

export interface AaveSnapshot {
  positions: AavePosition[];
  totalCollateralUsd: number;
  totalDebtUsd: number;
  liquidationThreshold: number; // 0..1
  healthFactor: number; // 1e18 mantissa -> number; 2^256-1 means "no debt"
  atRisk: boolean;
  /** % drop on the collateral needed to reach HF = 1 (uniform). */
  liquidationDropPct: number;
}

export const HF_NO_DEBT = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;

export async function getAaveSnapshot(account: Address): Promise<AaveSnapshot | null> {
  try {
    const data = await publicClient.readContract({
      address: AAVE_V3_POOL_BSC,
      abi: aavePoolAbi,
      functionName: "getUserAccountData",
      args: [account],
    });
    const [totalCollateralBase, totalDebtBase, , currentLiquidationThreshold, , healthFactorMantissa] =
      data as [bigint, bigint, bigint, bigint, bigint, bigint];

    const totalCollateralUsd = fromBaseUnits(totalCollateralBase, 8n); // base currency 8 decimals
    const totalDebtUsd = fromBaseUnits(totalDebtBase, 8n);
    if (totalCollateralUsd === 0 && totalDebtUsd === 0) return null;
    const liquidationThreshold = Number(currentLiquidationThreshold) / 1e4;
    const noDebt = healthFactorMantissa === HF_NO_DEBT;

    // Enumerate the user's reserves: we don't know which assets they hold, so
    // scan the common BSC reserve assets.
    const commonAssets = [
      { symbol: "USDT", addr: "0x55d398326f99059fF775485246999027B3197955" },
      { symbol: "USDC", addr: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" },
      { symbol: "BNB", addr: "0x0000000000000000000000000000000000000000" },
      { symbol: "BTCB", addr: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c" },
      { symbol: "ETH", addr: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8" },
      { symbol: "FDUSD", addr: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409" },
      { symbol: "XRP", addr: "0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE" },
      { symbol: "CAKE", addr: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82" },
      { symbol: "WBETH", addr: "0xa2E3356610840701BDf5611a53974510Ae27E2e1" },
    ] as const;

    const reads = await publicClient.multicall({
      contracts: commonAssets.map((a) => ({
        address: AAVE_V3_DATA_PROVIDER_BSC,
        abi: aaveDataProviderAbi,
        functionName: "getUserReserveData",
        args: [a.addr as Address, account],
      })),
    });

    const positions: AavePosition[] = [];
    for (let i = 0; i < commonAssets.length; i++) {
      const r = reads[i].result as
        | [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean]
        | undefined;
      if (!r) continue;
      const [aBalance, stableDebt, variableDebt] = r;
      const supplied = Number(aBalance) / 1e18;
      const borrowed = (Number(stableDebt) + Number(variableDebt)) / 1e18;
      if (supplied === 0 && borrowed === 0) continue;
      positions.push({
        symbol: commonAssets[i].symbol,
        asset: commonAssets[i].addr as Address,
        suppliedTokens: supplied,
        borrowedTokens: borrowed,
      });
    }

    const healthFactor = noDebt ? Infinity : Number(healthFactorMantissa) / 1e18;
    const atRisk = !noDebt && healthFactor <= 1.05;
    // Uniform % drop to reach HF=1: HF * (1 - d) = 1  -> d = 1 - 1/HF
    const liquidationDropPct =
      !noDebt && healthFactor > 1 ? (1 - 1 / healthFactor) * 100 : 0;

    return {
      positions,
      totalCollateralUsd,
      totalDebtUsd,
      liquidationThreshold,
      healthFactor,
      atRisk,
      liquidationDropPct,
    };
  } catch (e) {
    logger.warn({ account, err: String(e) }, "aave scan failed");
    return null;
  }
}
