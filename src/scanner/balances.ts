import type { Address } from "viem";
import { publicClient } from "../lib/rpc";
import { erc20Abi } from "./abis";
import { ADDRESSES } from "../config";
import { getTokenUsdPrice } from "./prices";
import { fromBaseUnits } from "../lib/money";
import { logger } from "../lib/logger";

export interface IdleStable {
  symbol: string;
  address: Address;
  balanceTokens: number;
  usd: number;
}

/**
 * Common stablecoin/position tokens we check for idle balances.
 * (USDT/USDC are 18 decimals on BSC — verified.)
 */
export const STABLES: { symbol: string; address: Address }[] = [
  { symbol: "USDT", address: ADDRESSES.usdt },
  { symbol: "USDC", address: ADDRESSES.usdc },
  { symbol: "FDUSD", address: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409" },
  { symbol: "USD1", address: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d" },
  { symbol: "U", address: "0xcE24439F2D9C6a2289F741120FE202248B666666" },
  { symbol: "DAI", address: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3" },
];

/**
 * Reads stablecoin balances for an account.
 * @param deployedUsdBySymbol USD already detected deployed (Venus/Aave) so we
 *   can subtract it and report genuinely idle capital.
 */
export async function getIdleStables(
  account: Address,
  deployedUsdBySymbol: Record<string, number> = {},
): Promise<IdleStable[]> {
  try {
    const reads = await publicClient.multicall({
      contracts: STABLES.map((s) => ({
        address: s.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      })),
    });

    const out: IdleStable[] = [];
    for (let i = 0; i < STABLES.length; i++) {
      const bal = reads[i].result as bigint | undefined;
      if (!bal || bal === 0n) continue;
      const tokens = fromBaseUnits(bal, 18n);
      const price = await getTokenUsdPrice(STABLES[i].address);
      const usd = tokens * price;
      const deployed = deployedUsdBySymbol[STABLES[i].symbol] ?? 0;
      const netUsd = Math.max(0, usd - deployed);
      if (netUsd >= 100) {
        out.push({ symbol: STABLES[i].symbol, address: STABLES[i].address, balanceTokens: tokens, usd: netUsd });
      }
    }
    return out;
  } catch (e) {
    logger.warn({ account, err: String(e) }, "stable balance scan failed");
    return [];
  }
}
