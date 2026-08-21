import postgres from "postgres";
import type { Store, MandateRecord, ReceiptRecord, RunRecord } from "./store";
import { fileStore } from "./file-store";
import { logger } from "../lib/logger";

/**
 * Store selector. Uses Postgres when DATABASE_URL is set, else the file store.
 * All persistence goes through `store()`.
 */

const pg = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL, { max: 5, idle_timeout: 20, connect_timeout: 10 })
  : null;

let pgStore: Store | null = null;

function buildPgStore(sql: postgres.Sql): Store {
  return {
    async createMandate(m: MandateRecord) {
      await sql`
        insert into mandates (id, wallet_address, agent_id, category, cap_usd, expiry_seconds, session_public_key, session_signer_encrypted, permissions, status, created_at)
        values (${m.id}, ${m.walletAddress.toLowerCase()}, ${m.agentId}, ${m.category ?? null}, ${m.capUsd}, ${m.expirySeconds}, ${m.sessionPublicKey}, ${m.sessionSignerEncrypted}, ${m.permissions ? sql.json(m.permissions as any) : null}, ${m.status}, ${m.createdAt})
      `;
    },
    async getMandate(id) {
      const r = await sql`select * from mandates where id = ${id}`;
      if (r.length === 0) return null;
      const x = r[0] as any;
      return {
        id: x.id,
        walletAddress: x.wallet_address,
        agentId: x.agent_id,
        category: x.category,
        capUsd: Number(x.cap_usd),
        expirySeconds: Number(x.expiry_seconds),
        sessionPublicKey: x.session_public_key,
        sessionSignerEncrypted: x.session_signer_encrypted,
        status: x.status,
        permissions: x.permissions,
        createdAt: x.created_at,
        revokedAt: x.revoked_at,
      };
    },
    async listMandates(walletAddress) {
      const r = await sql`select * from mandates where wallet_address = ${walletAddress.toLowerCase()} order by created_at desc`;
      return r.map((x: any) => ({
        id: x.id,
        walletAddress: x.wallet_address,
        agentId: x.agent_id,
        category: x.category,
        capUsd: Number(x.cap_usd),
        expirySeconds: Number(x.expiry_seconds),
        sessionPublicKey: x.session_public_key,
        sessionSignerEncrypted: x.session_signer_encrypted,
        permissions: x.permissions,
        status: x.status,
        createdAt: x.created_at,
        revokedAt: x.revoked_at,
      }));
    },
    async listActiveMandates() {
      const r = await sql`select * from mandates where status = 'active' and expiry_seconds > ${Math.floor(Date.now() / 1000)}`;
      return r.map((x: any) => ({
        id: x.id,
        walletAddress: x.wallet_address,
        agentId: x.agent_id,
        category: x.category,
        capUsd: Number(x.cap_usd),
        expirySeconds: Number(x.expiry_seconds),
        sessionPublicKey: x.session_public_key,
        sessionSignerEncrypted: x.session_signer_encrypted,
        permissions: x.permissions,
        status: x.status,
        createdAt: x.created_at,
        revokedAt: x.revoked_at,
      }));
    },
    async setMandateStatus(id, status, revokedAt) {
      await sql`update mandates set status = ${status}, revoked_at = ${revokedAt ?? null} where id = ${id}`;
    },
    async addReceipt(r: ReceiptRecord) {
      await sql`
        insert into receipts (id, mandate_id, agent_id, event, detail, tx_hash, before_state, after_state, created_at)
        values (${r.id}, ${r.mandateId}, ${r.agentId}, ${r.event}, ${sql.json(r.detail as any)}, ${r.txHash ?? null}, ${r.beforeState ? sql.json(r.beforeState as any) : null}, ${r.afterState ? sql.json(r.afterState as any) : null}, ${r.createdAt})
      `;
    },
    async listReceipts(walletAddress, limit = 50) {
      const r = await sql`
        select r.* from receipts r join mandates m on m.id = r.mandate_id
        where m.wallet_address = ${walletAddress.toLowerCase()} order by r.created_at desc limit ${limit}
      `;
      return r.map((x: any) => ({
        id: x.id,
        mandateId: x.mandate_id,
        agentId: x.agent_id,
        event: x.event,
        detail: x.detail ?? {},
        txHash: x.tx_hash,
        beforeState: x.before_state ?? undefined,
        afterState: x.after_state ?? undefined,
        createdAt: x.created_at,
      }));
    },
    async addRun(r: RunRecord) {
      await sql`
        insert into proving_runs (id, agent_id, task, status, started_at, completed_at, result, tx_hashes)
        values (${r.id}, ${r.agentId}, ${r.task}, ${r.status}, ${r.startedAt}, ${r.completedAt ?? null}, ${r.result ? sql.json(r.result as any) : null}, ${r.txHashes})
      `;
    },
    async updateRun(id, patch) {
      const sets: string[] = [];
      const vals: any[] = [];
      if (patch.status) { sets.push(`status = $${vals.length + 1}`); vals.push(patch.status); }
      if (patch.completedAt) { sets.push(`completed_at = $${vals.length + 1}`); vals.push(patch.completedAt); }
      if (patch.result) { sets.push(`result = $${vals.length + 1}`); vals.push(JSON.stringify(patch.result)); }
      if (patch.txHashes) { sets.push(`tx_hashes = $${vals.length + 1}`); vals.push(patch.txHashes); }
      if (sets.length === 0) return;
      await sql.unsafe(`update proving_runs set ${sets.join(", ")} where id = $${vals.length + 1}`, [...vals, id]);
    },
    async listRuns(agentId) {
      const r = agentId
        ? await sql`select * from proving_runs where agent_id = ${agentId} order by started_at desc`
        : await sql`select * from proving_runs order by started_at desc`;
      return r.map((x: any) => ({
        id: x.id,
        agentId: x.agent_id,
        task: x.task,
        status: x.status,
        startedAt: x.started_at,
        completedAt: x.completed_at,
        result: x.result ?? undefined,
        txHashes: x.tx_hashes ?? [],
      }));
    },
    async upsertAgent(agent: any) {
      await sql`
        insert into agents (agent_id, data, updated_at) values (${agent.agentId}, ${sql.json(agent)}, now())
        on conflict (agent_id) do update set data = excluded.data, updated_at = now()
      `;
    },
    async listAgents(category?: string) {
      if (category) {
        const r = await sql`select data from agents where data->'categories' ? ${category} order by updated_at desc`;
        return r.map((x: any) => x.data);
      }
      const r = await sql`select data from agents order by updated_at desc`;
      return r.map((x: any) => x.data);
    },
    async getAgent(agentId: string) {
      const r = await sql`select data from agents where agent_id = ${agentId}`;
      return r.length ? r[0].data : null;
    },
    async countAgents() {
      const r = await sql`select count(*)::int as n from agents`;
      return Number(r[0].n);
    },
  };
}

/** The active store. */
export function store(): Store {
  if (pg) {
    if (!pgStore) pgStore = buildPgStore(pg);
    return pgStore;
  }
  return fileStore;
}

/** Idempotent schema init. */
export async function initDb(): Promise<void> {
  if (!pg) {
    logger.info("using file store (no DATABASE_URL)");
    return;
  }
  await pg`
    create table if not exists mandates (
      id text primary key,
      wallet_address text not null,
      agent_id text not null,
      category text,
      cap_usd numeric not null,
      expiry_seconds integer not null,
      session_public_key text,
      session_signer_encrypted text,
      permissions jsonb,
      status text not null default 'active',
      created_at timestamptz not null default now(),
      revoked_at timestamptz
    );
  `;
  await pg`
    create table if not exists receipts (
      id text primary key,
      mandate_id text not null references mandates(id),
      agent_id text not null,
      event text not null,
      detail jsonb not null default '{}',
      tx_hash text,
      before_state jsonb,
      after_state jsonb,
      created_at timestamptz not null default now()
    );
  `;
  await pg`
    create table if not exists proving_runs (
      id text primary key,
      agent_id text not null,
      task text not null,
      status text not null,
      started_at timestamptz not null default now(),
      completed_at timestamptz,
      result jsonb,
      tx_hashes text[] not null default '{}'
    );
  `;
  await pg`
    create table if not exists agents (
      agent_id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    );
  `;
  logger.info("db schema ready");
}
