/**
 * Storage interface for mandates/receipts/proving-runs.
 * Two implementations: Postgres (DATABASE_URL set) and a file store (dev/demo
 * default). All app code talks to this interface only.
 */

export interface MandateRecord {
  id: string;
  walletAddress: string;
  agentId: string;
  category?: string;
  capUsd: number;
  expirySeconds: number;
  sessionPublicKey: string;
  sessionSignerEncrypted: string;
  /** The granted session permissions (needed to reconstruct the session for the relay). */
  permissions?: unknown;
  status: "active" | "revoked" | "expired";
  createdAt: Date;
  revokedAt?: Date;
}

export interface ReceiptRecord {
  id: string;
  mandateId: string;
  agentId: string;
  event: string;
  detail: Record<string, unknown>;
  txHash?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  createdAt: Date;
}

export interface RunRecord {
  id: string;
  agentId: string;
  task: string;
  status: "running" | "ok" | "miss" | "error";
  startedAt: Date;
  completedAt?: Date;
  result?: Record<string, unknown>;
  txHashes: string[];
}

export interface Store {
  createMandate(m: MandateRecord): Promise<void>;
  getMandate(id: string): Promise<MandateRecord | null>;
  listMandates(walletAddress: string): Promise<MandateRecord[]>;
  listActiveMandates(): Promise<MandateRecord[]>;
  setMandateStatus(id: string, status: MandateRecord["status"], revokedAt?: Date): Promise<void>;
  addReceipt(r: ReceiptRecord): Promise<void>;
  listReceipts(walletAddress: string, limit?: number): Promise<ReceiptRecord[]>;
  addRun(r: RunRecord): Promise<void>;
  updateRun(id: string, patch: Partial<RunRecord>): Promise<void>;
  listRuns(agentId?: string): Promise<RunRecord[]>;
  upsertAgent(agent: unknown): Promise<void>;
  deleteAgent(agentId: string): Promise<void>;
  listAgents(category?: string): Promise<unknown[]>;
  getAgent(agentId: string): Promise<unknown | null>;
  countAgents(): Promise<number>;
}
