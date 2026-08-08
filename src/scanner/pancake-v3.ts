import type { Address } from "viem";
import { publicClient } from "../lib/rpc";
import { pcsV3NpmAbi, pcsV3FactoryAbi, pcsV3PoolAbi, erc20Abi } from "./abis";
import { ADDRESSES } from "../config";
import { getTokenUsdPrice } from "./prices";
import { logger } from "../lib/logger";

export interface V3Position {
  tokenId: number;
  token0: Address;
  token1: Address;
  symbol0: string;
  symbol1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  liquidity: bigint;
  inRange: boolean;
  /** Fees owed but uncollected, USD (approx). */
  feesOwedUsd: number;
  /** Estimated position size in USD. */
  sizeUsd: number;
  /** Days (approx) the price has been outside the range, if known. 0 = unknown. */
  outOfRangeDays: number;
  price: number; // token1 per token0
  lowerPrice: number;
  upperPrice: number;
}

export interface V3Snapshot {
  positions: V3Position[];
  totalUsd: number;
  outOfRangeUsd: number;
}

const TICK_BASE = 1.0001;

/**
 * Uniswap v3 position amounts from liquidity and ticks.
 * Price P is in units of token1 per token0.
 * Returns {amount0, amount1} in token units.
 */
export function v3Amounts(
  liquidity: bigint,
  currentSqrt: number,
  sqrtLower: number,
  sqrtUpper: number,
): { amount0: number; amount1: number } {
  const L = Number(liquidity);
  const p = currentSqrt;
  const pa = sqrtLower;
  const pb = sqrtUpper;
  const amt1 = (x: number) => L * x;

  if (p <= pa) {
    // entirely in token0
    return { amount0: L * (1 / pa - 1 / pb), amount1: 0 };
  }
  if (p >= pb) {
    // entirely in token1
    return { amount0: 0, amount1: amt1(pb - pa) };
  }
  return {
    amount0: L * (1 / p - 1 / pb),
    amount1: amt1(p - pa),
  };
}

/** sqrtPriceX96 (from slot0) as a plain number. */
export function sqrtX96ToNumber(sqrtPriceX96: bigint): number {
  return Number(sqrtPriceX96) / 2 ** 96;
}

export async function getV3Snapshot(account: Address): Promise<V3Snapshot | null> {
  try {
    const balance = await publicClient.readContract({
      address: ADDRESSES.pancakeV3NPM,
      abi: pcsV3NpmAbi,
      functionName: "balanceOf",
      args: [account],
    });

    if (Number(balance) === 0) return null;

    // Enumerate token ids owned.
    const tokenIds: bigint[] = [];
    for (let i = 0; i < Number(balance); i++) {
      const id = await publicClient.readContract({
        address: ADDRESSES.pancakeV3NPM,
        abi: pcsV3NpmAbi,
        functionName: "tokenOfOwnerByIndex",
        args: [account, BigInt(i)],
      });
      tokenIds.push(id);
    }

    // Batch-read position metadata.
    const posData = await publicClient.multicall({
      contracts: tokenIds.map((id) => ({
        address: ADDRESSES.pancakeV3NPM,
        abi: pcsV3NpmAbi,
        functionName: "positions",
        args: [id],
      })),
    });

    const positions: V3Position[] = [];
    for (let i = 0; i < tokenIds.length; i++) {
      const p = posData[i].result as
        | [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint]
        | undefined;
      if (!p) continue;
      const [, , token0, token1, fee, tickLower, tickUpper, liquidity] = p;
      if (liquidity === 0n) continue; // closed position

      // Resolve pool & current tick.
      const pool = await publicClient.readContract({
        address: ADDRESSES.pancakeV3Factory,
        abi: pcsV3FactoryAbi,
        functionName: "getPool",
        args: [token0, token1, fee],
      });

      let currentTick = 0;
      let price = 0;
      let sqrtCurrent = 0;
      if (pool !== "0x0000000000000000000000000000000000000000") {
        const slot0 = await publicClient.readContract({
          address: pool as Address,
          abi: pcsV3PoolAbi,
          functionName: "slot0",
        });
        const sqrtPriceX96 = (slot0 as any)[0] as bigint;
        currentTick = (slot0 as any)[1];
        sqrtCurrent = sqrtX96ToNumber(sqrtPriceX96);
        price = sqrtCurrent * sqrtCurrent;
      }

      const [s0, s1] = await Promise.all([
        publicClient.readContract({
          address: token0,
          abi: erc20Abi,
          functionName: "symbol",
        }).catch(() => "TOKEN0"),
        publicClient.readContract({
          address: token1,
          abi: erc20Abi,
          functionName: "symbol",
        }).catch(() => "TOKEN1"),
      ]);

      const lowerPrice = Math.pow(TICK_BASE, tickLower);
      const upperPrice = Math.pow(TICK_BASE, tickUpper);
      const inRange = price >= lowerPrice && price <= upperPrice;

      // Compute position USD size from liquidity + token prices.
      const sqrtLower = Math.sqrt(lowerPrice);
      const sqrtUpper = Math.sqrt(upperPrice);
      let sizeUsd = 0;
      const feesOwedUsd = 0;
      if (sqrtCurrent > 0) {
        const { amount0, amount1 } = v3Amounts(liquidity, sqrtCurrent, sqrtLower, sqrtUpper);
        const p0 = await getTokenUsdPrice(token0);
        const p1 = await getTokenUsdPrice(token1);
        sizeUsd = amount0 * p0 + amount1 * p1;
      }

      positions.push({
        tokenId: Number(tokenIds[i]),
        token0,
        token1,
        symbol0: s0 as string,
        symbol1: s1 as string,
        fee,
        tickLower,
        tickUpper,
        currentTick,
        liquidity,
        inRange,
        feesOwedUsd,
        sizeUsd,
        outOfRangeDays: 0,
        price,
        lowerPrice,
        upperPrice,
      });
    }

    const totalUsd = positions.reduce((s, p) => s + p.sizeUsd, 0);
    const outOfRangeUsd = positions
      .filter((p) => !p.inRange)
      .reduce((s, p) => s + p.sizeUsd, 0);

    return { positions, totalUsd, outOfRangeUsd };
  } catch (e) {
    logger.warn({ account, err: String(e) }, "pcs v3 scan failed");
    return null;
  }
}
