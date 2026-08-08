import { store } from "../db";
import type { AgentRecord, Category } from "./model";
import { CATEGORIES } from "./model";

/**
 * Read-side queries over the verified agent registry. The marketplace surface
 * renders from THIS — never from the raw 8004scan metadata directly.
 */

export async function agentsForCategory(category: Category): Promise<AgentRecord[]> {
  return (await store().listAgents(category)) as AgentRecord[];
}

export async function getAgent(agentId: string): Promise<AgentRecord | null> {
  return (await store().getAgent(agentId)) as AgentRecord | null;
}

/** Count of indexed agents per category. */
export async function categoryCounts(): Promise<Record<string, number>> {
  const all = (await store().listAgents()) as AgentRecord[];
  const counts: Record<string, number> = {};
  for (const a of all) for (const c of a.categories ?? []) counts[c] = (counts[c] ?? 0) + 1;
  return counts;
}

export async function totalIndexed(): Promise<number> {
  return store().countAgents();
}

export { CATEGORIES };
