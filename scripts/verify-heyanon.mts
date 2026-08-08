/**
 * Verify the known-good HeyAnon agent family (x402 + registry health 100).
 * Useful to seed the marketplace with verified supply quickly.
 * Run: pnpm tsx scripts/verify-heyanon.mts
 */
import { loadEnv } from "../src/lib/env";
import { indexAgent } from "../src/registry/ingest";
import { verifyAgent } from "../src/registry/verify";
import { store } from "../src/db";
import { logger } from "../src/lib/logger";

const HEYANON = [85400, 45650, 45614, 45564, 45422, 45381, 43129];

async function main() {
  loadEnv();
  for (const token of HEYANON) {
    try {
      const rec = await indexAgent(56, token);
      const v = await verifyAgent(rec);
      await store().upsertAgent(v);
      logger.info(
        { token, name: v.name, cats: v.categories, health: v.healthStatus, tools: v.services.mcp?.verified?.length ?? 0 },
        "heyAnon verified",
      );
    } catch (e: any) {
      logger.warn({ token, err: String(e?.message ?? e) }, "heyAnon verify failed");
    }
    // Shared host rate-limits aggressively — keep spacing.
    await new Promise((r) => setTimeout(r, 4000));
  }
}

main().catch((e) => {
  logger.error({ err: String(e) }, "failed");
  process.exit(1);
});
