import { isAddress, type Address } from "viem";
import type { AgentRecord, McpService } from "./model";
import { classify } from "./classify";
import { logger } from "../lib/logger";
import { throttle } from "../lib/throttle";

/**
 * Ingest from the 8004scan public API. We filter `protocol=MCP` server-side
 * (verified working) to get high-signal, machine-callable agents, then fetch
 * per-agent detail for service endpoints. List-level fields only carry
 * declared metadata; capability is confirmed later by `verify`.
 */

const BASE = "https://8004scan.io/api/v1/public";
const PAGE = 100;

interface ListAgent {
  agent_id?: string;
  token_id?: number;
  chain_id?: number;
  name?: string;
  description?: string;
  owner_address?: string;
  owner_publisher_tier?: string;
  supported_protocols?: string[];
  x402_supported?: boolean;
  total_score?: number;
  total_feedbacks?: number;
  average_score?: number;
  health_score?: number;
  star_count?: number;
  is_verified?: boolean;
  created_at?: string;
}

/**
 * Fetch one page of MCP-capable BSC agents, highest registry score first.
 *
 * The sort order is load-bearing, not cosmetic. There are 5,086 MCP agents on
 * BSC and the default (token-id) order is dominated by a single publisher that
 * mints one token per user: 2,990 of the newest 3,000 rows are named "Q402
 * Agent (by Quack AI)" and all 2,990 declare the SAME endpoint. A bounded walk
 * in default order therefore spends every detail fetch on one callable
 * service. Ordering by score puts real agents on page 1.
 */
export async function fetchMcpPage(page: number): Promise<ListAgent[]> {
  const url =
    `${BASE}/agents?chainId=56&protocol=MCP&limit=${PAGE}&page=${page}` +
    `&sortBy=total_score&order=desc`;
  await throttle("8004scan").take();
  const body = await getJson<{ data?: ListAgent[] }>(url);
  return body.data ?? [];
}

/** GET with bounded retry — the registry API intermittently stalls past 20s. */
async function getJson<T>(url: string, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`8004scan ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Fetch the full detail record for one agent (has services/endpoints). */
export async function fetchAgentDetail(chainId: number, tokenId: number): Promise<any> {
  await throttle("8004scan").take();
  const body = await getJson<{ data?: any }>(`${BASE}/agents/${chainId}/${tokenId}`);
  return body.data ?? null;
}

/** Map a list row + optional detail into our AgentRecord (capability unverified). */
export function toRecord(list: ListAgent, detail: any | null): AgentRecord {
  const protocols = list.supported_protocols ?? [];
  const services = detail?.services ?? {};

  let mcp: McpService | undefined;
  if (services.mcp?.endpoint) {
    mcp = { endpoint: services.mcp.endpoint, version: services.mcp.version, tools: services.mcp.tools ?? [] };
  }

  const toolNames = [...(mcp?.tools ?? [])];
  const { categories, reasons, claimedOnly } = classify(toolNames, list.description ?? "");

  const owner = (list.owner_address ?? detail?.owner_address) as Address | undefined;
  const wallet = (detail?.agent_wallet ?? detail?.owner_address ?? owner) as Address | undefined;

  return {
    chainId: list.chain_id ?? 56,
    tokenId: list.token_id ?? 0,
    agentId: list.agent_id ?? `${list.chain_id ?? 56}:${list.token_id ?? 0}`,
    name: list.name ?? `Agent #${list.token_id}`,
    description: list.description ?? "",
    owner: owner && isAddress(owner) ? owner : ("0x0000000000000000000000000000000000000000" as Address),
    wallet: wallet && isAddress(wallet) ? wallet : ("0x0000000000000000000000000000000000000000" as Address),
    categories,
    categoryReasons: reasons,
    claimedOnly,
    protocols,
    x402: Boolean(list.x402_supported),
    services: {
      mcp,
      a2a: services.a2a?.endpoint ? { endpoint: services.a2a.endpoint, version: services.a2a.version } : undefined,
      web: services.web?.endpoint ? { endpoint: services.web.endpoint } : undefined,
    },
    uptimeChecks: 0,
    uptimeOk: 0,
    tags: detail?.tags ?? [],
    registryScore: list.total_score ?? 0,
    registryFeedbacks: list.total_feedbacks ?? 0,
    createdAt: list.created_at,
    endpointKey: mcp ? endpointKey(mcp.endpoint) : undefined,
  };
}

/**
 * Normalize an MCP endpoint so that trivially different URLs for the same
 * service collapse: case, default ports, trailing slashes, and the `/mcp`
 * vs `/mcp/` vs `/sse` suffix all describe one server.
 */
export function endpointKey(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const port = u.port && u.port !== (u.protocol === "https:" ? "443" : "80") ? `:${u.port}` : "";
    const path = u.pathname.replace(/\/+$/, "").replace(/\/(mcp|sse|messages)$/i, "");
    return `${host}${port}${path}`;
  } catch {
    return raw.trim().toLowerCase().replace(/\/+$/, "");
  }
}

/**
 * Elect one canonical record per MCP endpoint and mark the others as aliases.
 * Preference order: verified tools present, then more declared tools, then
 * higher registry score, then more feedbacks, then oldest (the original
 * publisher), then lowest token id as a deterministic tiebreak.
 */
export function dedupeByEndpoint(records: AgentRecord[]): AgentRecord[] {
  const groups = new Map<string, AgentRecord[]>();
  const out: AgentRecord[] = [];

  for (const r of records) {
    if (!r.endpointKey) {
      out.push(r);
      continue;
    }
    const g = groups.get(r.endpointKey);
    if (g) g.push(r);
    else groups.set(r.endpointKey, [r]);
  }

  const rank = (a: AgentRecord) => [
    // A fetched record always beats one whose endpoint we only inferred, so a
    // canonical row is never built from unverified data.
    a.endpointInferred ? 0 : 1,
    a.services.mcp?.verified?.length ? 1 : 0,
    a.services.mcp?.tools.length ?? 0,
    a.registryScore,
    a.registryFeedbacks,
    -new Date(a.createdAt ?? "2999-01-01").getTime(),
    -a.tokenId,
  ];

  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
      return 0;
    });
    const [canonical, ...dupes] = sorted;
    out.push({
      ...canonical,
      endpointKey: key,
      aliases: dupes.map((d) => d.agentId),
    });
    for (const d of dupes) out.push({ ...d, endpointKey: key, duplicateOf: canonical.agentId });
  }
  return out;
}

/** Index one agent by chain/token id (for the vertical slice + spot checks). */
export async function indexAgent(chainId: number, tokenId: number): Promise<AgentRecord> {
  const detail = await fetchAgentDetail(chainId, tokenId);
  if (!detail) throw new Error(`agent ${chainId}/${tokenId} not found`);
  const list: ListAgent = {
    chain_id: detail.chain_id,
    token_id: detail.token_id,
    agent_id: detail.agent_id,
    name: detail.name,
    description: detail.description,
    owner_address: detail.owner_address,
    supported_protocols: detail.supported_protocols,
    x402_supported: detail.x402_supported,
    total_score: detail.total_score,
    total_feedbacks: detail.total_feedbacks,
    created_at: detail.created_at,
  };
  return toRecord(list, detail);
}

/**
 * Page through MCP agents in score order, deduped by endpoint.
 *
 * Detail fetches are the expensive step (one HTTP call per token), and the
 * registry is dominated by publishers that mint one token per user pointing at
 * a single shared endpoint. To avoid spending the entire budget on them we
 * probe the first `PROBE_LIMIT` occurrences of each agent name; if those all
 * resolve to the same endpoint, later rows with that name are recorded as
 * inferred aliases without a fetch. Measured: 300 score-ordered rows contain
 * 219 copies of one name, so this turns 219 fetches into 3.
 *
 * The inference is deliberately conservative — it only ever kicks in from the
 * 4th duplicate of a name onward, and only when the probes are unanimous, so a
 * name reused by genuinely different services is always fetched properly.
 */
const PROBE_LIMIT = 3;

export async function ingestMcpAgents(maxPages = 100): Promise<AgentRecord[]> {
  const records: AgentRecord[] = [];
  /** name -> endpoints seen in probes (unanimous single entry => inferable). */
  const probes = new Map<string, { seen: Set<string>; n: number }>();
  let inferred = 0;

  const inferableEndpoint = (name: string): string | undefined => {
    const p = probes.get(name);
    if (!p || p.n < PROBE_LIMIT || p.seen.size !== 1) return undefined;
    return [...p.seen][0];
  };

  for (let page = 1; page <= maxPages; page++) {
    let rows: ListAgent[];
    try {
      rows = await fetchMcpPage(page);
    } catch (e: any) {
      logger.warn({ page, err: String(e?.message ?? e) }, "ingest page failed");
      break;
    }
    if (rows.length === 0) break;

    // Split each page: rows we can infer cost nothing, the rest get fetched.
    const toFetch: ListAgent[] = [];
    for (const r of rows) {
      const endpoint = inferableEndpoint(r.name ?? "");
      if (endpoint) {
        const rec = toRecord(r, { services: { mcp: { endpoint } } });
        records.push({ ...rec, endpointInferred: true });
        inferred++;
      } else {
        toFetch.push(r);
      }
    }

    for (let i = 0; i < toFetch.length; i += 6) {
      const slice = toFetch.slice(i, i + 6);
      const details = await Promise.all(
        slice.map((r) => fetchAgentDetail(r.chain_id ?? 56, r.token_id ?? 0).catch(() => null)),
      );
      slice.forEach((r, j) => {
        const rec = toRecord(r, details[j]);
        records.push(rec);
        const name = r.name ?? "";
        const p = probes.get(name) ?? { seen: new Set<string>(), n: 0 };
        p.n++;
        if (rec.endpointKey) p.seen.add(rec.services.mcp!.endpoint);
        else p.seen.add("<none>");
        probes.set(name, p);
      });
    }
    logger.info({ page, count: records.length, inferred }, "ingested page");
  }

  const deduped = dedupeByEndpoint(records);
  const canonical = deduped.filter((r) => !r.duplicateOf).length;
  logger.info(
    { total: deduped.length, canonical, inferred, fetchesSaved: inferred },
    "ingest complete (endpoint-deduped)",
  );
  return deduped;
}
