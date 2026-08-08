import { store } from "../db";
import { verifyAgent } from "./verify";
import type { AgentRecord } from "./model";
import { logger } from "../lib/logger";
import { throttle } from "../lib/throttle";

/**
 * Batch verification run (background worker + on-demand). Iterates indexed
 * agents that aren't yet verified (or are stale), probes their MCP endpoints
 * with throttling, and persists the results.
 */
export async function verifyAgents(opts: { limit?: number; refresh?: boolean } = {}): Promise<{
  scanned: number;
  healthy: number;
  unreachable: number;
}> {
  const s = store();
  const all = (await s.listAgents()) as AgentRecord[];
  const sixHoursAgo = Date.now() - 6 * 3600 * 1000;
  const stale = all.filter((a) =>
    opts.refresh ? true : !a.verifiedAt || new Date(a.verifiedAt).getTime() < sixHoursAgo,
  );
  // Prioritize likely-real agents: x402 + declared MCP endpoint + registry health.
  const score = (a: AgentRecord) =>
    (a.x402 ? 2 : 0) +
    (a.services.mcp?.endpoint ? 2 : 0) +
    (a.registryScore > 0 ? 1 : 0) +
    (a.healthStatus === "unreachable" ? -3 : 0); // don't re-probe known-dead every cycle
  const targets = [...stale].sort((a, b) => score(b) - score(a)).slice(0, opts.limit ?? stale.length);

  let healthy = 0;
  let unreachable = 0;
  let scanned = 0;
  for (const rec of targets) {
    const before = rec.uptimeOk;
    await verifyAgent(rec);
    if (rec.healthStatus === "healthy") healthy++;
    if (rec.healthStatus === "unreachable") unreachable++;
    if (rec.uptimeOk > before) scanned++;
    await s.upsertAgent(rec);
    // Politeness: third-party endpoints rate-limit hard (verified).
    await throttle("probe").take();
  }
  logger.info({ scanned, healthy, unreachable }, "verification run complete");
  return { scanned, healthy, unreachable };
}
