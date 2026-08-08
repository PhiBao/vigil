import type { Address } from "viem";
import { publicClient } from "../lib/rpc";
import { comptrollerAbi, oracleAbi, vTokenAbi } from "./abis";
import { ADDRESSES } from "../config";
import { fromBaseUnits } from "../lib/money";
import { logger } from "../lib/logger";

/** One Venus market position for an account. */
export interface VenusPosition {
  vToken: Address;
  symbol: string;
  underlying: Address; // zero address == native BNB
  collateralFactor: number; // 0..1
  suppliedUsd: number;
  borrowedUsd: number;
  /** USD price of underlying. */
  priceUsd: number;
}

export interface VenusSnapshot {
  positions: VenusPosition[];
  /** Total borrow value in USD. */
  totalBorrowUsd: number;
  /** Weighted collateral value (supply * CF) in USD. */
  weightedCollateralUsd: number;
  /** Health factor: weightedCollateral / borrows. Infinity when no borrows. */
  healthFactor: number;
  /** True if HF <= 1 (liquidation shortfall). */
  atRisk: boolean;
  /** Price change % needed on the dominant collateral to reach HF = 1. */
  liquidationDropPct: number;
  /** Which symbol the liquidation price refers to. */
  dominantCollateralSymbol: string;
}

const WBNB = ADDRESSES.wbnb;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export async function getVenusSnapshot(account: Address): Promise<VenusSnapshot | null> {
  try {
    const entered = await publicClient.readContract({
      address: ADDRESSES.venusComptroller,
      abi: comptrollerAbi,
      functionName: "getAssetsIn",
      args: [account],
    });
    if (entered.length === 0) return null;

    const oracle = await publicClient.readContract({
      address: ADDRESSES.venusComptroller,
      abi: comptrollerAbi,
      functionName: "oracle",
    });

    const positions: VenusPosition[] = [];

    // Read market params for all entered markets in parallel.
    const marketRes = await publicClient.multicall({
      contracts: entered.map((v) => ({
        address: ADDRESSES.venusComptroller,
        abi: comptrollerAbi,
        functionName: "markets",
        args: [v],
      })),
    });

    const snapshots = await publicClient.multicall({
      contracts: entered.map((v) => ({
        address: v,
        abi: vTokenAbi,
        functionName: "getAccountSnapshot",
        args: [account],
      })),
    });

    const symbols = await publicClient.multicall({
      contracts: entered.map((v) => ({
        address: v,
        abi: vTokenAbi,
        functionName: "symbol",
      })),
    });

    const underlyings = await publicClient.multicall({
      contracts: entered.map((v) => ({
        address: v,
        abi: vTokenAbi,
        functionName: "underlying",
      })),
    });

    const prices = await publicClient.multicall({
      contracts: entered.map((v) => ({
        address: oracle as Address,
        abi: oracleAbi,
        functionName: "getUnderlyingPrice",
        args: [v],
      })),
    });

    for (let i = 0; i < entered.length; i++) {
      const v = entered[i];
      const market = marketRes[i].result as [boolean, bigint, boolean] | undefined;
      const snap = snapshots[i].result as [bigint, bigint, bigint, bigint] | undefined;
      const sym = symbols[i].result as string | undefined;
      const priceRaw = prices[i].result as bigint | undefined;

      if (!market || !snap) continue;
      const [, collateralFactorMantissa] = market;
      const [, balance, borrowBalance, exchangeRateMantissa] = snap;

      // underlying() reverts for native BNB markets.
      let underlying: Address = ZERO;
      const u = underlyings[i].result;
      if (typeof u === "string") underlying = u as Address;

      // supply = balance * exchangeRate  (exchangeRate mantissa scaled to underlying 18 decimals)
      const exchangeRate = Number(exchangeRateMantissa) / 1e18;
      const suppliedUnits = Number(balance) * exchangeRate;

      const priceUsd = priceRaw ? fromBaseUnits(priceRaw, 18n) : 0;
      const collateralFactor = Number(collateralFactorMantissa) / 1e18;

      positions.push({
        vToken: v,
        symbol: sym ?? v.slice(0, 10),
        underlying: underlying === ZERO ? WBNB : underlying,
        collateralFactor,
        suppliedUsd: suppliedUnits * priceUsd,
        borrowedUsd: fromBaseUnits(borrowBalance, 18n) * priceUsd,
        priceUsd,
      });
    }

    if (positions.length === 0) return null;

    const totalBorrowUsd = positions.reduce((s, p) => s + p.borrowedUsd, 0);
    const weightedCollateralUsd = positions.reduce(
      (s, p) => s + p.suppliedUsd * p.collateralFactor,
      0,
    );

    // Self-consistency cross-check against the protocol's canonical value:
    // getAccountLiquidity returns (0, liquidity, shortfall) in USD, where
    // liquidity ≈ weightedCollateral - borrows. Log a warning on divergence.
    try {
      const [, liquidityRaw, shortfallRaw] = await publicClient.readContract({
        address: ADDRESSES.venusComptroller,
        abi: comptrollerAbi,
        functionName: "getAccountLiquidity",
        args: [account],
      });
      const protocolLiq = fromBaseUnits(liquidityRaw, 18n) - fromBaseUnits(shortfallRaw, 18n);
      const ours = weightedCollateralUsd - totalBorrowUsd;
      if (Math.abs(protocolLiq - ours) > Math.max(1, Math.abs(ours) * 0.02)) {
        logger.warn(
          { account, protocolLiq, ours, diff: protocolLiq - ours },
          "venus HF math diverges from protocol getAccountLiquidity",
        );
      }
    } catch (e) {
      logger.warn({ err: String(e) }, "venus liquidity cross-check unavailable");
    }

    // Health factor & liquidation sensitivity.
    let healthFactor = Infinity;
    let atRisk = false;
    let liquidationDropPct = 0;
    let dominantCollateralSymbol = "";

    if (totalBorrowUsd > 0) {
      healthFactor = weightedCollateralUsd / totalBorrowUsd;
      atRisk = healthFactor <= 1.05; // small buffer; diagnosis handles thresholds
      // Dominant collateral = the supply contributing most to weighted collateral.
      let maxW = 0;
      for (const p of positions) {
        const w = p.suppliedUsd * p.collateralFactor;
        if (w > maxW) {
          maxW = w;
          dominantCollateralSymbol = p.symbol;
        }
      }
      // Find the price drop (applied to all collateral uniformly) that brings HF to 1.
      // HF = (weightedCollateral * x) / borrows  ->  x = borrows / weightedCollateral
      if (weightedCollateralUsd > 0) {
        const x = totalBorrowUsd / weightedCollateralUsd;
        liquidationDropPct = (1 - x) * 100;
      }
    } else {
      // no borrows: nothing to liquidate
      healthFactor = Infinity;
    }

    return {
      positions,
      totalBorrowUsd,
      weightedCollateralUsd,
      healthFactor,
      atRisk,
      liquidationDropPct,
      dominantCollateralSymbol,
    };
  } catch (e) {
    logger.warn({ account, err: String(e) }, "venus scan failed");
    return null;
  }
}
