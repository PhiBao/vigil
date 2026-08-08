/**
 * Phase 0 vertical slice: index a real third-party agent (HeyAnon Venus),
 * classify it by tool signature, verify it live, and persist.
 * Run: pnpm tsx scripts/index-venus.mts
 */
import { loadEnv } from "../src/lib/env";
import { indexAgent } from "../src/registry/ingest";
import { verifyAgent } from "../src/registry/verify";
import { freshness } from "../src/registry/verify";
import { store } from "../src/db";
import { isHireable } from "../src/registry/model";
import { logger } from "../src/lib/logger";

async function main() {
  loadEnv();
  const tokenId = Number(process.argv[2] ?? 43129); // Venus powered by HeyAnon
  logger.info({ tokenId }, "indexing agent");

  const rec = await indexAgent(56, tokenId);
  logger.info({ name: rec.name, x402: rec.x402, protocols: rec.protocols }, "indexed");

  const verified = await verifyAgent(rec);
  logger.info(
    {
      name: verified.name,
      categories: verified.categories,
      verifiedTools: verified.services.mcp?.verified?.length ?? 0,
      health: verified.healthStatus,
      hireable: isHireable(verified),
      freshness: freshness(verified),
      reasons: verified.categoryReasons,
    },
    "verified agent",
  );

  await store().upsertAgent(verified);
  logger.info({ total: await store().countAgents() }, "persisted");
}

main().catch((e) => {
  logger.error({ err: String(e?.message ?? e) }, "index failed");
  process.exit(1);
});
