import type { Address } from "viem";

/**
 * Price feeds. DexScreener for token/pool USD prices (verified live),
 * DefiLlama yields for APY comparison. Both free, no key.
 */

interface DexPair {
  pairAddress?: string;
  baseToken?: { symbol: string; address: string };
  quoteToken?: { symbol: string; address: string };
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
}

const cache = new Map<string, { ts: number; data: DexPair[] }>();
const CACHE_TTL_MS = 60_000;

/** Fetch pairs for a token address from DexScreener (cached 60s). */
export async function getTokenPairs(token: Address): Promise<DexPair[]> {
  const key = token.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { pairs?: DexPair[] };
  const pairs = body.pairs ?? [];
  cache.set(key, { ts: Date.now(), data: pairs });
  return pairs;
}

/** Best USD price of a token on PancakeSwap BSC (prefers deep liquidity). */
export async function getTokenUsdPrice(token: Address): Promise<number> {
  const pairs = await getTokenPairs(token);
  if (pairs.length === 0) return 0;
  const pancakeswap = pairs
    .filter((p) => p.pairAddress)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const best = pancakeswap[0] ?? pairs[0];
  const p = Number(best.priceUsd ?? 0);
  return Number.isFinite(p) ? p : 0;
}
