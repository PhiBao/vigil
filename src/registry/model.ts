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
}

export const isHireable = (a: AgentRecord): boolean =>
  Boolean(a.x402 && a.services.mcp && a.verifiedAt);
