import type { Address } from "viem";

/**
 * The verified agent registry. One row per ERC-8004 agent that we have
 * indexed + verified. Capability lives in the tool signature, so this is the
 * source of truth the marketplace renders — not the raw registry metadata.
 */

export type Category = "health_factor" | "rebalancing" | "yield" | "grid" | "monitoring";

export const CATEGORIES: { id: Category; label: string; hint: string }[] = [
  { id: "health_factor", label: "Health factor", hint: "Protects lending positions from liquidation" },
  { id: "rebalancing", label: "Rebalancing", hint: "Manages LP ranges, resets positions automatically" },
  { id: "yield", label: "Yield", hint: "Routes capital to where it earns most" },
  { id: "grid", label: "Grid trading", hint: "Runs automated strategies within set ranges" },
  { id: "monitoring", label: "Monitoring", hint: "Watches markets, wallets, and positions" },
];

export interface McpService {
  endpoint: string;
  version?: string;
  tools: string[];
  /** Tools fetched from the live endpoint (verified), vs the declared list. */
  verified?: string[];
}

export interface AgentRecord {
  chainId: number;
  tokenId: number;
  agentId: string; // chain:registry:token
  name: string;
  description: string;
  owner: Address;
  wallet: Address;
  categories: Category[];
  /** Reason each category was assigned (auditable). */
  categoryReasons: Record<string, string[]>;
  /**
   * Categories the publisher's description advertises but the tool signature
   * does not support. Shown as an unverified claim, never as a capability.
   */
  claimedOnly: Category[];
  protocols: string[];
  x402: boolean;
  services: {
    mcp?: McpService;
    a2a?: { endpoint: string; version?: string };
    web?: { endpoint: string };
  };
  // Verification state (ours, not the registry's).
  verifiedAt?: string;
  healthStatus?: "healthy" | "unreachable" | "unknown";
  lastSeenAt?: string;
  uptimeChecks: number;
  uptimeOk: number;
  tags: string[];
  registryScore: number;
  registryFeedbacks: number;
  createdAt?: string;
  /**
   * Endpoint clustering. Many distinct token IDs resolve to the SAME MCP
   * endpoint, so they are one callable service. This is the dominant feature
   * of the registry, not an edge case: BSC has 5,086 MCP agents, and 2,990 of
   * the newest 3,000 are one publisher minting a token per user, all declaring
   * the identical endpoint. Owner address does NOT identify these (986
   * distinct owners per 1,000 rows) — only the endpoint does.
   *
   * We elect one canonical record per endpoint and mark the rest as aliases.
   * Without this the marketplace shows one server thousands of times under
   * thousands of names.
   */
  endpointKey?: string;
  /** agentId of the canonical record, when this row is a duplicate. */
  duplicateOf?: string;
  /** agentIds sharing this endpoint, when this row is canonical. */
  aliases?: string[];
  /**
   * True when the endpoint was inferred from sibling rows with an identical
   * name rather than fetched. Only set on mass-minted duplicates, which always
   * lose the canonical election, so an inferred row is never shown as a
   * callable service.
   */
  endpointInferred?: boolean;
}

export const isHireable = (a: AgentRecord): boolean =>
  Boolean(a.x402 && a.services.mcp && a.verifiedAt);
