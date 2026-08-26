"use client";

import { createClient, BNB, BNB_TESTNET, type SessionPermissions } from "@altananetwork/sdk";

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
  return window.location.hostname || undefined;
}

/** Which chain to use for Altana. Testnet is free via faucet, mainnet needs real BNB. */
export function getAltanaChainId(): number {
  // Allow explicit override via env
  const env = (process.env.NEXT_PUBLIC_ALTANA_CHAIN ?? "").toLowerCase();
  if (env === "testnet" || env === "97") return 97;
  if (env === "mainnet" || env === "56") return 56;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    // Vercel preview + localhost default to testnet for free demo funding
    if (host.includes("vercel.app") || host === "localhost" || host === "127.0.0.1") return 97;
  }
  return 56;
}

export function getAltanaChain() {
  return getAltanaChainId() === 97 ? BNB_TESTNET : BNB;
}

export function isUserCancelError(e: unknown): boolean {
  const err = e as any;
  const name = err?.name as string | undefined;
  const msg = String(err?.message ?? err ?? "");
  return (
    name === "NotAllowedError" ||
    name === "AbortError" ||
    (name === "InvalidStateError" && msg.includes("cancel")) ||
    msg.includes("No passkey selected") ||
    msg.includes("cancelled") ||
    msg.includes("canceled") ||
    msg.includes("The operation either timed out or was not allowed")
  );
}

export function isNoKeysRegisteredError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e ?? "");
  return msg.includes("has no keys registered") || msg.includes("doesn't carry a wallet address");
}

export function isInsufficientFundsError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e ?? "");
  const causeMsg = String((e as any)?.cause?.message ?? "");
  const combined = msg + " " + causeMsg;
  // Relay returns 0x for many failures, but insufficient funds also surfaces as 0x on prepareCalls
  // We treat any 0x execution error as potentially funding-related and show funding UI.
  return (
    combined.includes("Reason: 0x") ||
    combined.includes("Details: 0x") ||
    combined.includes("insufficient funds") ||
    combined.includes("exceeds balance") ||
    combined.includes("InsufficientFunds")
  );
}

export function extractWalletFromNoKeysError(e: unknown): string | null {
  const msg = String((e as any)?.message ?? e ?? "");
  const m = msg.match(/0x[a-fA-F0-9]{40}/);
  return m ? m[0] : null;
}

export class AltanaClient {
  // Support both chains so we can switch per call via chainId
  private client = createClient({ chains: [BNB, BNB_TESTNET] });

  /** Recover an existing passkey wallet — shows the OS picker, user must pick one. */
  async recoverWallet() {
    const chainId = getAltanaChainId();
    const w = await this.client.recoverFromPasskey({ chainId, rpId: rpId() });
    return { wallet: w, signer: w.signer, chainId };
  }

  /** Create a brand new passkey wallet — prompts to create a new credential. */
  async createWallet(name = "Vigil") {
    const chainId = getAltanaChainId();
    const w = await this.client.createPasskeyWallet({ name, rpId: rpId() });
    return { wallet: w, signer: w.signer, chainId };
  }

  /**
   * @deprecated — auto-fallback masked user cancellation. Use recoverWallet/createWallet explicitly.
   */
  async getWallet(name = "Vigil") {
    try {
      return await this.recoverWallet();
    } catch (e) {
      if (isUserCancelError(e)) throw e;
      const w = await this.createWallet(name);
      return w;
    }
  }

  async grantWithWallet(
    wallet: { address: string; signer: any },
    signer: any,
    opts: {
      permissions: SessionPermissions;
      expirySeconds: number;
      chainId?: number;
    },
  ) {
    const chainId = opts.chainId ?? getAltanaChainId();
    const session = await this.client.grantSession({
      wallet: wallet as any,
      signer,
      permissions: opts.permissions,
      expiry: opts.expirySeconds,
      chainId,
      register: true,
    });
    const sessionKey = (session.signer as any)._privateKey as `0x${string}` | undefined;
    if (!sessionKey) throw new Error("Could not extract session key for persistence");
    return { wallet, signer, session, sessionKey, chainId };
  }

  async grant(opts: {
    mode?: "recover" | "create";
    walletName?: string;
    walletAddress?: string;
    permissions: SessionPermissions;
    expirySeconds: number;
  }) {
    const mode = opts.mode ?? "recover";
    const res = mode === "create" ? await this.createWallet(opts.walletName ?? "Vigil") : await this.recoverWallet();
    const { wallet, signer, chainId } = res;
    if (opts.walletAddress && wallet.address.toLowerCase() !== opts.walletAddress.toLowerCase()) {
      throw new Error("Wallet mismatch — this passkey belongs to a different wallet.");
    }
    const session = await this.client.grantSession({
      wallet: wallet as any,
      signer,
      permissions: opts.permissions,
      expiry: opts.expirySeconds,
      chainId,
      register: true,
    });
    const sessionKey = (session.signer as any)._privateKey as `0x${string}` | undefined;
    if (!sessionKey) throw new Error("Could not extract session key for persistence");
    return { wallet, signer, session, sessionKey, chainId };
  }

  /** One-click revocation — always recovers, never creates. */
  async revoke(walletAddress: string, sessionPublicKey: string) {
    const { wallet, signer } = await this.recoverWallet();
    if (wallet.address.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error("Wallet mismatch.");
    }
    await this.client.revokeSession({
      wallet: wallet as any,
      signer,
      session: sessionPublicKey as `0x${string}`,
      chainId: getAltanaChainId(),
    });
  }
}
