/**
 * Registry worker: continuously ingest + verify BSC agents in the background.
 * Verification accrues over the build period (rate-limited by design).
 * Run: pnpm tsx scripts/verify-worker.mts [--interval=600] [--once]
 */
import { loadEnv } from "../src/lib/env";
import { ingestMcpAgents } from "../src/registry/ingest";
import { verifyAgents } from "../src/registry/verify-run";
import { store } from "../src/db";
import { logger } from "../src/lib/logger";

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const intervalArg = args.find((a) => a.startsWith("--interval="));
  const interval = intervalArg ? Number(intervalArg.split("=")[1]) : 600;

  logger.info({ interval }, "registry worker starting");

  const cycle = async () => {
    const t0 = Date.now();
    // 1. Ingest a fresh page of MCP agents (bounded) to keep supply growing.
    try {
      const fresh = await ingestMcpAgents(1);
      const s = store();
      for (const r of fresh) await s.upsertAgent(r);
      logger.info({ ingested: fresh.length, total: await s.countAgents() }, "ingest cycle");
    } catch (e: any) {
      logger.warn({ err: String(e?.message ?? e) }, "ingest cycle failed");
    }
    // 2. Verify a batch of unverified/stale agents.
    const res = await verifyAgents({ limit: 10 });
    logger.info({ ...res, ms: Date.now() - t0 }, "verify cycle complete");
  };

  if (once) {
    await cycle();
    process.exit(0);
  }

  while (true) {
    try {
      await cycle();
    } catch (e: any) {
      logger.error({ err: String(e?.message ?? e) }, "cycle error");
    }
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
}

main().catch((e) => {
  logger.error({ err: String(e) }, "worker failed");
  process.exit(1);
});
