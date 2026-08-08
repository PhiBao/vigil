import { logger } from "../lib/logger";

/**
 * BSC yield opportunities from DefiLlama (free API, verified live).
 * Used by the Stable Router agent and the diagnosis engine to quantify
 * "idle capital" findings.
 */

export interface BscPool {
  pool: string;
  project: string;
  symbol: string;
  apy: number;
  apyMean30d: number;
  apyPct7D: number;
  tvlUsd: number;
  stablecoin: boolean;
  ilRisk: string | null;
  volumeUsd1d: number;
}

let cache: { ts: number; pools: BscPool[] } | null = null;
const TTL_MS = 5 * 60_000;

/** Fetch all BSC pools from DefiLlama yields (cached 5 min). */
export async function getBscPools(): Promise<BscPool[]> {
  const now = Date.now();
  if (cache && now - cache.ts < TTL_MS) return cache.pools;
  try {
    const res = await fetch("https://yields.llama.fi/pools", {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`defillama ${res.status}`);
    const body = (await res.json()) as { data: any[] };
    const pools = body.data
      .filter((p) => p.chain === "BSC")
      .map((p) => ({
        pool: p.pool,
        project: p.project,
        symbol: p.symbol,
        apy: p.apy ?? 0,
        apyMean30d: p.apyMean30d ?? 0,
        apyPct7D: p.apyPct7D ?? 0,
        tvlUsd: p.tvlUsd ?? 0,
        stablecoin: !!p.stablecoin,
        ilRisk: p.ilRisk ?? null,
        volumeUsd1d: p.volumeUsd1d ?? 0,
      }));
    cache = { ts: now, pools };
    return pools;
  } catch (e) {
    logger.warn({ err: String(e) }, "defillama yields fetch failed");
    return cache?.pools ?? [];
  }
}

/** Best risk-adjusted stablecoin pool on BSC (TVL>250k, stablecoin, ranked by 30d mean). */
export async function bestStablePool(): Promise<BscPool | null> {
  const pools = await getBscPools();
  const candidates = pools
    .filter((p) => p.stablecoin && p.tvlUsd >= 250_000 && p.apyMean30d > 0)
    .sort((a, b) => b.apyMean30d - a.apyMean30d);
  return candidates[0] ?? null;
}

/** Reference spread for "idle capital": median vs p90 stablecoin pool APY. */
export async function stableYieldSpread(): Promise<{ medianApy: number; p90Apy: number } | null> {
  const pools = await getBscPools();
  const stables = pools
    .filter((p) => p.stablecoin && p.tvlUsd >= 250_000 && p.apyMean30d > 0)
    .map((p) => p.apyMean30d)
    .sort((a, b) => a - b);
  if (stables.length === 0) return null;
  const med = stables[Math.floor(stables.length / 2)];
  const p90 = stables[Math.min(stables.length - 1, Math.floor(stables.length * 0.9))];
  return { medianApy: med, p90Apy: p90 };
}
