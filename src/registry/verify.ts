import type { AgentRecord } from "./model";
import { listTools } from "./mcp";
import { classify } from "./classify";
import { logger } from "../lib/logger";

/**
 * Live verification worker. Calls a third-party agent's MCP endpoint
 * (`tools/list`) to confirm it is actually reachable and to read its real
 * capability surface. Results are cached and updated on a slow cadence —
 * endpoints rate-limit aggressively (verified), so verification must never run
 * on the user-facing path.
 *
 * Classification is REDONE here whenever we get fresh tool evidence: most
 * publishers declare an empty tool list in the registry, so ingest-time
 * classification sees nothing. The live probe is often the first real evidence
 * — treating verification as read-only would leave exactly those agents
 * unclassified forever.
 */

/** Single in-process cache with a TTL; refreshed by the background worker. */
const cache = new Map<string, { tools: string[]; at: string; ok: boolean; error?: string }>();
const TTL_MS = 6 * 60 * 60 * 1000; // 6h (background worker refreshes)

/** Classify from live tool evidence, keeping the description as claim-checking material. */
function reclassify(rec: AgentRecord): void {
  const tools = rec.services.mcp?.verified ?? [];
  if (!tools.length) return;
  const { categories, reasons, claimedOnly } = classify(tools, rec.description ?? "");
  rec.categories = categories;
  rec.categoryReasons = reasons as Record<string, string[]>;
  rec.claimedOnly = claimedOnly;
}

/** Verify (or read cached) an agent's MCP endpoint. Mutates the record. */
export async function verifyAgent(rec: AgentRecord): Promise<AgentRecord> {
  const ep = rec.services.mcp?.endpoint;
  if (!ep) {
    rec.healthStatus = "unknown";
    return rec;
  }
  const hit = cache.get(ep);
  if (hit && Date.now() - new Date(hit.at).getTime() < TTL_MS) {
    if (rec.services.mcp) rec.services.mcp.verified = hit.tools;
    rec.verifiedAt = hit.at;
    rec.healthStatus = hit.ok ? "healthy" : "unreachable";
    rec.uptimeChecks += 1;
    if (hit.ok) {
      rec.uptimeOk += 1;
      reclassify(rec);
    }
    return rec;
  }
  try {
    const tools = await listTools(ep);
    cache.set(ep, { tools: tools.map((t) => t.name), at: new Date().toISOString(), ok: true });
    if (rec.services.mcp) rec.services.mcp.verified = tools.map((t) => t.name);
    rec.verifiedAt = new Date().toISOString();
    rec.healthStatus = "healthy";
    rec.uptimeChecks += 1;
    rec.uptimeOk += 1;
    reclassify(rec);
    logger.info({ agent: rec.name, tools: tools.length, cats: rec.categories }, "verified agent");
  } catch (e: any) {
    cache.set(ep, { tools: [], at: new Date().toISOString(), ok: false, error: String(e?.message ?? e) });
    rec.healthStatus = "unreachable";
    rec.uptimeChecks += 1;
    logger.warn({ agent: rec.name, err: String(e?.message ?? e) }, "agent unreachable");
  }
  return rec;
}

/** Human-readable freshness of the verification. */
export function freshness(rec: AgentRecord): string {
  if (!rec.verifiedAt) return "never verified";
  const hrs = (Date.now() - new Date(rec.verifiedAt).getTime()) / 3_600_000;
  if (hrs < 1) return "verified <1h ago";
  if (hrs < 24) return `verified ${Math.round(hrs)}h ago`;
  return `verified ${Math.round(hrs / 24)}d ago`;
}
