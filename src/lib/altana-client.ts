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

export class AltanaClient {
  private client = createClient({ chains: [BNB] });

  /** Create or recover the user's passkey wallet for this app. */
  async getWallet(name = "Vigil") {
    try {
      // Recover first (existing passkey), fall back to creating.
      const w = await this.client.recoverFromPasskey({ rpId: window.location.hostname });
      return { wallet: w, signer: w.signer };
    } catch {
      const w = await this.client.createPasskeyWallet({ name, rpId: window.location.hostname });
      return { wallet: w, signer: w.signer };
    }
  }

  /**
   * Grant a scoped session on the user's wallet.
   * `expectedAddress` is optional — on first hire the passkey creates the wallet.
   */
  async grant(opts: {
    walletAddress?: string;
    permissions: SessionPermissions;
    expirySeconds: number;
  }) {
    const { wallet, signer } = await this.getWallet();
    if (opts.walletAddress && wallet.address.toLowerCase() !== opts.walletAddress.toLowerCase()) {
      throw new Error("Wallet mismatch — this passkey belongs to a different wallet.");
    }
    const session = await this.client.grantSession({
      wallet,
      signer,
      permissions: opts.permissions,
      expiry: opts.expirySeconds,
      register: true,
    });
    const sessionKey = (session.signer as any)._privateKey as `0x${string}` | undefined;
    if (!sessionKey) throw new Error("Could not extract session key for persistence");
    return { wallet, signer, session, sessionKey };
  }

  /** One-click revocation (admin key signs). */
  async revoke(walletAddress: string, sessionPublicKey: string) {
    const { wallet, signer } = await this.getWallet();
    if (wallet.address.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error("Wallet mismatch.");
    }
    await this.client.revokeSession({
      wallet,
      signer,
      session: sessionPublicKey as `0x${string}`,
    });
  }
}
