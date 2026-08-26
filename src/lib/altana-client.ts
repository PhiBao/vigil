"use client";

import { createClient, BNB, type SessionPermissions } from "@altananetwork/sdk";

/**
 * Browser-side Altana wrapper. The admin key lives in the device's secure
 * hardware (WebAuthn passkey); we never see it. We create/recover a wallet,
 * grant a scoped session, and hand the resulting SESSION (with its own
 * secp256k1 key) to the server for the agent runtime.
 */
export type { Session, SessionPermissions } from "@altananetwork/sdk";

export interface MandateRequest {
  walletAddress: string;
  agentId: string;
  capUsd: number;
  expirySeconds: number;
  findingId?: string;
  sessionPublicKey: string;
  sessionSigner: string; // hex private key of the SESSION key (agent's key)
  permissions: SessionPermissions;
}

function rpId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  // On localhost the rpId must be "localhost", on vercel.app it is the full hostname.
  // Passing undefined lets the SDK default to window.location.hostname which is correct
  // for both, but we expose it for testability.
  return window.location.hostname || undefined;
}

export function isUserCancelError(e: unknown): boolean {
  const err = e as any;
  const name = err?.name as string | undefined;
  const msg = String(err?.message ?? err ?? "");
  // WebAuthn cancellations surface as NotAllowedError / AbortError.
  // SDK also throws "No passkey selected." when the picker returns null.
  return (
    name === "NotAllowedError" ||
    name === "AbortError" ||
    name === "InvalidStateError" && msg.includes("cancel") ||
    msg.includes("No passkey selected") ||
    msg.includes("cancelled") ||
    msg.includes("canceled") ||
    msg.includes("The operation either timed out or was not allowed")
  );
}

export class AltanaClient {
  private client = createClient({ chains: [BNB] });

  /** Recover an existing passkey wallet — shows the OS picker, user must pick one. */
  async recoverWallet() {
    const w = await this.client.recoverFromPasskey({ rpId: rpId() });
    return { wallet: w, signer: w.signer };
  }

  /** Create a brand new passkey wallet — prompts to create a new credential. */
  async createWallet(name = "Vigil") {
    const w = await this.client.createPasskeyWallet({ name, rpId: rpId() });
    return { wallet: w, signer: w.signer };
  }

  /**
   * @deprecated — auto-fallback masked user cancellation as “no passkey” and
   * triggered a second prompt immediately after the user cancelled. Use
   * `recoverWallet()` / `createWallet()` explicitly instead.
   */
  async getWallet(name = "Vigil") {
    try {
      return await this.recoverWallet();
    } catch (e) {
      if (isUserCancelError(e)) throw e;
      // Only fall back to creation when the error clearly indicates no credential,
      // not when the user actively cancelled. But even then we prefer explicit UI,
      // so this path is kept only for backwards compat and should not be used by new code.
      const w = await this.createWallet(name);
      return w;
    }
  }

  /**
   * Grant a scoped session on the user's wallet.
   * Caller must provide the wallet+signer obtained via `recoverWallet` or `createWallet`.
   * `expectedAddress` is optional — on first hire the passkey creates the wallet.
   */
  async grantWithWallet(
    wallet: { address: string; signer: any },
    signer: any,
    opts: {
      permissions: SessionPermissions;
      expirySeconds: number;
    },
  ) {
    const session = await this.client.grantSession({
      wallet: wallet as any,
      signer,
      permissions: opts.permissions,
      expiry: opts.expirySeconds,
      register: true,
    });
    const sessionKey = (session.signer as any)._privateKey as `0x${string}` | undefined;
    if (!sessionKey) throw new Error("Could not extract session key for persistence");
    return { wallet, signer, session, sessionKey };
  }

  /**
   * Grant a scoped session — explicit mode version. Prefer `grantWithWallet` when
   * you already have the wallet; this helper chooses recover vs create based on mode.
   */
  async grant(opts: {
    mode?: "recover" | "create";
    walletName?: string;
    walletAddress?: string;
    permissions: SessionPermissions;
    expirySeconds: number;
  }) {
    const mode = opts.mode ?? "recover";
    const { wallet, signer } =
      mode === "create" ? await this.createWallet(opts.walletName ?? "Vigil") : await this.recoverWallet();
    if (opts.walletAddress && wallet.address.toLowerCase() !== opts.walletAddress.toLowerCase()) {
      throw new Error("Wallet mismatch — this passkey belongs to a different wallet.");
    }
    const session = await this.client.grantSession({
      wallet: wallet as any,
      signer,
      permissions: opts.permissions,
      expiry: opts.expirySeconds,
      register: true,
    });
    const sessionKey = (session.signer as any)._privateKey as `0x${string}` | undefined;
    if (!sessionKey) throw new Error("Could not extract session key for persistence");
    return { wallet, signer, session, sessionKey };
  }

  /** One-click revocation (admin key signs) — always recovers, never creates. */
  async revoke(walletAddress: string, sessionPublicKey: string) {
    const { wallet, signer } = await this.recoverWallet();
    if (wallet.address.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error("Wallet mismatch.");
    }
    await this.client.revokeSession({
      wallet: wallet as any,
      signer,
      session: sessionPublicKey as `0x${string}`,
    });
  }
}
