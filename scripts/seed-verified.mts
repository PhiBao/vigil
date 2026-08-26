/**
 * Seed verified, multi-vendor supply into the registry.
 *
 * This is the supply side of the marketplace fix: hand-curated ERC-8004
 * tokens representing every DISTINCT live MCP service found during the Aug 26
 * census of all 5,086 BSC MCP agents (census method: name+description → 344
 * distinct publishers → detail fetches → 103 distinct endpoints → 20 live
 * probes). Each entry below resolves to exactly one endpoint, so they are
 * canonical by construction — no alias elections needed.
 *
 * Also prunes stale rows that the older (pre-dedupe) indexer left behind:
 * records without an MCP endpoint, or marked duplicateOf, or unreachable with
 * no verified tools. Those are noise, not supply.
 *
 * Run: pnpm tsx scripts/seed-verified.mts
 */
import { loadEnv } from "../src/lib/env";
import { indexAgent } from "../src/registry/ingest";
import { verifyAgent } from "../src/registry/verify";
import { store } from "../src/db";
import type { AgentRecord } from "../src/registry/model";
import { logger } from "../src/lib/logger";

/** [tokenId, label] — chain 56. Labels cite the vendor so logs stay readable. */
const SEEDS: Array<[number, string]> = [
  // HeyAnon family (one owner, 7 distinct endpoints — NOT duplicates)
  [43129, "Venus · HeyAnon"],
  [45381, "Aave · HeyAnon"],
  [85400, "Aster perps · HeyAnon"],
  [45650, "V3 Pools LP · HeyAnon"],
  [45564, "Token Swaps · HeyAnon"],
  [45422, "Beefy vaults · HeyAnon"],
  [45614, "Cross-chain bridge · HeyAnon"],
  // Independent Venus operators (different owner 0xd16faaa9…, own infra)
  [266933, "BNB Lending Guardian"],
  [265876, "BNB Yield Optimizer"],
  // Other vendors, live on probe day
  [305820, "Cortez · Singularry (233 aliases share this endpoint)"],
  [113284, "Topaz ve(3,3) Dex agent"],
  [251399, "ChainHelix attestation stack"],
  [2468, "ClawdMint wallet console"],
  [49637, "OpenOdds prediction markets"],
  [126728, "Pretium fiat rails"],
  [49467, "Brain On BNB AI ($BOBAI)"],
  [258641, "Sentinels audit agent"],
];

async function pruneStale(): Promise<number> {
  const all = (await store().listAgents()) as AgentRecord[];
  const deadIds: string[] = [];
  for (const a of all) {
    const neverVerified = !(a.services?.mcp?.verified ?? []).length;
    const dead =
      !a.services?.mcp?.endpoint ||            // nothing to call
      a.duplicateOf !== undefined ||           // non-canonical alias row
      (neverVerified && a.healthStatus !== "healthy"); // no evidence of a callable service
    if (dead) deadIds.push(a.agentId);
  }
  for (const id of deadIds) await store().deleteAgent(id);
  if (deadIds.length) {
    logger.info({ removed: deadIds.length }, "pruned stale registry rows");
  }
  return deadIds.length;
}

async function main() {
  loadEnv();
  const removed = await pruneStale();
  if (removed) logger.info({ removed }, "pruned stale registry rows");

  let ok = 0;
  for (const [tokenId, label] of SEEDS) {
    try {
      const rec = await indexAgent(56, tokenId);
      const v = await verifyAgent(rec);
      await store().upsertAgent(v);
      ok++;
      logger.info(
        {
          token: tokenId,
          label,
          name: v.name,
          cats: v.categories,
          claimedOnly: v.claimedOnly,
          health: v.healthStatus,
          tools: v.services.mcp?.verified?.length ?? 0,
          x402: v.x402,
        },
        "seeded",
      );
    } catch (e: any) {
      logger.warn({ token: tokenId, label, err: String(e?.message ?? e) }, "seed failed");
    }
    // Be gentle with shared hosts (HeyAnon serves 7 endpoints off one domain).
    await new Promise((r) => setTimeout(r, 1200));
  }

  // Summary across everything now in the store.
  const all = ((await store().listAgents()) as AgentRecord[]).filter((a) => !a.duplicateOf);
  const byCat: Record<string, number> = {};
  const byCatHireable: Record<string, number> = {};
  const vendors = new Set<string>();
  for (const a of all) {
    for (const c of a.categories ?? []) {
      byCat[c] = (byCat[c] ?? 0) + 1;
      if (a.x402 && a.services.mcp && a.verifiedAt) byCatHireable[c] = (byCatHireable[c] ?? 0) + 1;
    }
    if (a.services.mcp) vendors.add(a.endpointKey ?? "");
  }
  logger.info(
    { seeded: ok, catalogSize: all.length, distinctEndpoints: vendors.size, byCategory: byCat, hireablePerCategory: byCatHireable },
    "seed complete",
  );
  console.log("\n=== post-seed catalog ===");
  for (const [cat, n] of Object.entries(byCat).sort((x, y) => y[1] - x[1])) {
    console.log(`  ${cat.padEnd(16)} ${String(n).padStart(3)}  (hireable ${byCatHireable[cat] ?? 0})`);
  }
}

main().catch((e) => {
  logger.error({ err: String(e) }, "seed failed");
  process.exit(1);
});
