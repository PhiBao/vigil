import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Store, MandateRecord, ReceiptRecord, RunRecord } from "./store";

/**
 * File-backed store for dev/demo when DATABASE_URL is absent.
 * Atomic-ish writes: serialize with a write queue, write temp + rename.
 * Data lives in ./data/vigil.json (gitignored).
 */

interface FileDbShape {
  mandates: MandateRecord[];
  receipts: ReceiptRecord[];
  runs: RunRecord[];
  agents: unknown[];
}

const FILE = process.env.VIGIL_DATA_FILE ?? resolve(process.cwd(), "data/vigil.json");

function load(): FileDbShape {
  if (!existsSync(FILE)) return { mandates: [], receipts: [], runs: [], agents: [] };
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as FileDbShape;
    if (!raw.agents) raw.agents = [];
    // Revive date fields (JSON round-trip turns Dates into ISO strings).
    for (const m of raw.mandates ?? []) {
      m.createdAt = new Date(m.createdAt as any);
      if (m.revokedAt) m.revokedAt = new Date(m.revokedAt as any);
    }
    for (const r of raw.receipts ?? []) r.createdAt = new Date(r.createdAt as any);
    for (const r of raw.runs ?? []) {
      r.startedAt = new Date(r.startedAt as any);
      if (r.completedAt) r.completedAt = new Date(r.completedAt as any);
    }
    return raw;
  } catch {
    return { mandates: [], receipts: [], runs: [], agents: [] };
  }
}

function save(shape: FileDbShape): void {
  mkdirSync(dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(shape));
  // atomic replace
  writeFileSync(FILE, JSON.stringify(shape));
  try {
    existsSync(tmp) && unlinkSync(tmp);
  } catch {
    /* ignore */
  }
}

export const fileStore: Store = {
  async createMandate(m) {
    const s = load();
    s.mandates.push(m);
    save(s);
  },
  async getMandate(id) {
    const s = load();
    const m = s.mandates.find((x) => x.id === id);
    if (!m) return null;
    // revive dates
    m.createdAt = new Date(m.createdAt as any);
    if (m.revokedAt) m.revokedAt = new Date(m.revokedAt as any);
    return m;
  },
  async listMandates(walletAddress) {
    return load()
      .mandates.filter((m) => m.walletAddress.toLowerCase() === walletAddress.toLowerCase())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  },
  async listActiveMandates() {
    const now = Date.now();
    return load().mandates.filter((m) => m.status === "active" && m.expirySeconds * 1000 > now);
  },
  async setMandateStatus(id, status, revokedAt) {
    const s = load();
    const m = s.mandates.find((x) => x.id === id);
    if (m) {
      m.status = status;
      if (revokedAt) m.revokedAt = revokedAt;
      save(s);
    }
  },
  async addReceipt(r) {
    const s = load();
    s.receipts.push(r);
    save(s);
  },
  async listReceipts(walletAddress, limit = 50) {
    const ws = walletAddress.toLowerCase();
    return load()
      .receipts.filter((r) => {
        const m = load().mandates.find((x) => x.id === r.mandateId);
        return m && m.walletAddress.toLowerCase() === ws;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  },
  async addRun(r) {
    const s = load();
    s.runs.push(r);
    save(s);
  },
  async updateRun(id, patch) {
    const s = load();
    const r = s.runs.find((x) => x.id === id);
    if (r) {
      Object.assign(r, patch);
      save(s);
    }
  },
  async listRuns(agentId) {
    const all = load().runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    return agentId ? all.filter((r) => r.agentId === agentId) : all;
  },
  async upsertAgent(agent: any) {
    const s = load();
    const i = s.agents.findIndex((a: any) => a.agentId === agent.agentId);
    if (i >= 0) s.agents[i] = agent;
    else s.agents.push(agent);
    save(s);
  },
  async deleteAgent(agentId: string) {
    const s = load();
    const before = s.agents.length;
    s.agents = s.agents.filter((a: any) => a.agentId !== agentId);
    if (s.agents.length !== before) save(s);
  },
  async listAgents(category?: string) {
    const all = load().agents as any[];
    if (!category) return all;
    return all.filter((a) => (a.categories ?? []).includes(category));
  },
  async getAgent(agentId: string) {
    return (load().agents as any[]).find((a) => a.agentId === agentId) ?? null;
  },
  async countAgents() {
    return (load().agents as any[]).length;
  },
};
