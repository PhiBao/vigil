/**
 * Phase 1: ingest MCP-capable BSC agents, classify, persist. No verification
 * (that's the throttled background worker). Reports per-category supply.
 * Run: pnpm tsx scripts/ingest-registry.mts [maxPages]
 */
import { loadEnv } from "../src/lib/env";
import { ingestMcpAgents } from "../src/registry/ingest";
import { store } from "../src/db";
import { isHireable } from "../src/registry/model";
import { logger } from "../src/lib/logger";

async function main() {
  loadEnv();
  const maxPages = Number(process.argv[2] ?? 100);
  const records = await ingestMcpAgents(maxPages);

  const s = store();
  for (const r of records) await s.upsertAgent(r);

  const byCat: Record<string, number> = {};
  const byCatHireable: Record<string, number> = {};
  for (const r of records) {
    for (const c of r.categories) {
      byCat[c] = (byCat[c] ?? 0) + 1;
      if (isHireable(r)) byCatHireable[c] = (byCatHireable[c] ?? 0) + 1;
    }
  }
  const x402 = records.filter((r) => r.x402).length;
  const mcp = records.filter((r) => r.services.mcp?.endpoint).length;

  logger.info(
    {
      total: records.length,
      x402,
      withMcpEndpoint: mcp,
      indexed: await s.countAgents(),
      byCategory: byCat,
      byCategoryHireable: byCatHireable,
    },
    "ingest complete",
  );

  // Print a quick table.
  console.log("\n=== BSC MCP-capable agent supply (declared, unverified) ===");
  for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(16)} ${String(n).padStart(4)}  (hireable-est. ${byCatHireable[cat] ?? 0})`);
  }
}

main().catch((e) => {
  logger.error({ err: String(e?.message ?? e) }, "ingest failed");
  process.exit(1);
});
