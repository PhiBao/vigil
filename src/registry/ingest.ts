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
  supported_protocols?: string[];
  x402_supported?: boolean;
  total_score?: number;
  total_feedbacks?: number;
  created_at?: string;
}

/** Fetch one page of MCP-capable BSC agents. */
export async function fetchMcpPage(page: number): Promise<ListAgent[]> {
  const url = `${BASE}/agents?chainId=56&protocol=MCP&limit=${PAGE}&page=${page}`;
  await throttle("8004scan").take();
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`8004scan ${res.status}`);
  const body = (await res.json()) as { data?: ListAgent[] };
  return body.data ?? [];
}

/** Fetch the full detail record for one agent (has services/endpoints). */
export async function fetchAgentDetail(chainId: number, tokenId: number): Promise<any> {
  await throttle("8004scan").take();
  const res = await fetch(`${BASE}/agents/${chainId}/${tokenId}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`8004scan detail ${res.status}`);
  const body = (await res.json()) as { data?: any };
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
  const { categories, reasons } = classify(toolNames, list.description ?? "");

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
  };
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

/** Page through all MCP agents (best effort, bounded). */
export async function ingestMcpAgents(maxPages = 100): Promise<AgentRecord[]> {
  const records: AgentRecord[] = [];
  for (let page = 1; page <= maxPages; page++) {
    let rows: ListAgent[];
    try {
      rows = await fetchMcpPage(page);
    } catch (e: any) {
      logger.warn({ page, err: String(e?.message ?? e) }, "ingest page failed");
      break;
    }
    if (rows.length === 0) break;
    // Batch detail fetches with concurrency 6.
    for (let i = 0; i < rows.length; i += 6) {
      const slice = rows.slice(i, i + 6);
      const details = await Promise.all(
        slice.map((r) => fetchAgentDetail(r.chain_id ?? 56, r.token_id ?? 0).catch(() => null)),
      );
      slice.forEach((r, j) => records.push(toRecord(r, details[j])));
    }
    logger.info({ page, count: records.length }, "ingested page");
  }
  return records;
}
