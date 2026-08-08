/**
 * Fast search: probe Venus getAssetsIn (one call per address), then full-scan
 * only addresses that have entered markets. Bound the work.
 * Run: pnpm tsx scripts/find-positions.mts
 */
import { isAddress } from "viem";
import { publicClient } from "../src/lib/rpc";
import { comptrollerAbi } from "../src/scanner/abis";
import { ADDRESSES } from "../src/config";
import { scanAddress } from "../src/scanner";
import { logger } from "../src/lib/logger";

async function harvestUsers(maxPages = 14): Promise<string[]> {
  const seen = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await fetch(`https://8004scan.io/api/v1/public/feedbacks?chainId=56&limit=100&page=${page}`);
      if (!res.ok) break;
      const d = (await res.json()) as any;
      const rows = d.data ?? [];
      if (rows.length === 0) break;
      for (const f of rows) {
        const u = f?.user?.address ?? f?.user_address;
        if (u && isAddress(u)) seen.add(u);
      }
    } catch {
      break;
    }
  }
  return [...seen];
}

async function venusHasMarkets(addr: string): Promise<boolean> {
  try {
    const entered = await publicClient.readContract({
      address: ADDRESSES.venusComptroller,
      abi: comptrollerAbi,
      functionName: "getAssetsIn",
      args: [addr as `0x${string}`],
    });
    return entered.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  const users = await harvestUsers();
  logger.info({ count: users.length }, "harvested users");

  // Fast probe in parallel batches of 8.
  const withVenus: string[] = [];
  for (let i = 0; i < users.length; i += 8) {
    const batch = users.slice(i, i + 8);
    const flags = await Promise.all(batch.map(venusHasMarkets));
    flags.forEach((has, j) => {
      if (has) withVenus.push(batch[j]);
    });
    if (withVenus.length >= 3) break;
  }
  logger.info({ withVenus: withVenus.length }, "venus position holders found");

  for (const addr of withVenus) {
    try {
      const s = await scanAddress(addr as `0x${string}`);
      logger.info(
        {
          addr,
          borrowUsd: Math.round(s.venus?.totalBorrowUsd ?? 0),
          hf: s.venus?.healthFactor === Infinity ? "inf" : s.venus?.healthFactor.toFixed(2),
          markets: s.venus?.positions.map((p) => `${p.symbol}(${p.suppliedUsd.toFixed(0)}+${p.borrowedUsd.toFixed(0)})`).join(","),
          v3: s.v3?.positions.length ?? 0,
        },
        "VENUS HOLDER",
      );
    } catch (e: any) {
      logger.warn({ addr, err: String(e?.message ?? e) }, "scan failed");
    }
  }
}

main().catch((e) => {
  logger.error({ err: String(e) }, "search failed");
  process.exit(1);
});
