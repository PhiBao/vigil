import { createClient, BNB, signerFromPrivateKey, type Session, type Call } from "@altananetwork/sdk";
import type { SessionPermissions } from "@altananetwork/sdk";
import { logger } from "../lib/logger";

/**
 * Auth metadata attached to every NEW mandate's persisted permissions JSON
 * (`permissions.__auth`, stored inside the same jsonb/file blob so both store
 * implementations carry it with no schema change). Legacy mandates predate run
 * tokens: no `__auth`, and /api/hire treats them as before.
 */
export interface RunAuthMeta {
  kind: string;
  sha256: string;
}

export function readAuthMeta(raw: unknown): RunAuthMeta | null {
  const meta = (raw as { __auth?: RunAuthMeta } | null)?.__auth;
  return meta && typeof meta.sha256 === "string" ? meta : null;
}

/**
 * Strip non-SDK metadata from persisted permissions before reconstructing a
 * Session. The Altana SDK expects exactly { calls, spend } — leaking __auth
 * into it would be undefined behavior.
 */
export function sdkPermissionsOf(raw: unknown): Pick<SessionPermissions, "calls" | "spend"> {
  const p = (raw ?? {}) as Partial<SessionPermissions>;
  return { calls: p.calls, spend: p.spend };
}

/**
 * Server-side executor. Runs actions through an Altana SESSION key (the
 * scoped, expiring key a user granted). The wallet admin key never exists on
 * the server. The session's `calls` allowlist + spend caps are enforced
 * onchain — this module can never act outside a session.
 */

export interface Executed {
  callsId: string;
  transactionHash?: string;
  status: "PENDING" | "CONFIRMED" | "FAILED";
}

export function sessionFromPersisted(
  sessionSignerKey: string,
  publicKey: string,
  permissions: Session["permissions"],
  expiry: number,
  walletAddress: `0x${string}`,
): Session {
  const signer = signerFromPrivateKey(sessionSignerKey as `0x${string}`);
  return { signer, publicKey: publicKey as `0x${string}`, permissions, expiry, walletAddress };
}

export class Executor {
  private client = createClient({ chains: [BNB] });

  async execute(
    session: Session,
    calls: Call | readonly Call[],
    opts: { confirm?: boolean } = { confirm: true },
  ): Promise<Executed> {
    if (opts.confirm === false) {
      logger.info({ wallet: session.walletAddress }, "executor (simulated)");
      return { callsId: "0xsimulated", status: "CONFIRMED", transactionHash: "0xsimulated" };
    }
    const res = await this.client.execute({ session, calls });
    logger.info({ wallet: session.walletAddress, status: res.status, tx: res.transactionHash }, "session execute");
    return res;
  }
}
