"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AltanaClient } from "@/lib/altana-client";
import { allowlistForCategory } from "@/mandate/permissions";
import type { Category } from "@/registry/model";

type Phase = "form" | "prompting" | "granting" | "done" | "error";

export function HireConsent({
  agentId,
  agentName,
  category,
  defaultCapUsd,
  defaultExpirySeconds,
}: {
  agentId: string;
  agentName: string;
  category: Category;
  defaultCapUsd: number;
  defaultExpirySeconds: number;
}) {
  const [capUsd, setCapUsd] = useState(defaultCapUsd);
  const [expirySeconds, setExpirySeconds] = useState(defaultExpirySeconds);
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const router = useRouter();

  async function grant() {
    setPhase("prompting");
    setError(null);
    try {
      // Build the session from the category allowlist (18-decimal BSC).
      const allow = allowlistForCategory(category);
      const sdkPermissions = {
        calls: allow.map((to) => ({ to } as { to: `0x${string}` })),
        spend: [
          { token: "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`, limit: BigInt(Math.round(capUsd * 1e18)), period: "day" as const },
        ],
      };
      const serializablePermissions = {
        calls: allow.map((to) => ({ to })),
        spend: [{ token: "0x55d398326f99059fF775485246999027B3197955", limit: String(BigInt(Math.round(capUsd * 1e18))), period: "day" }],
      };

      const client = new AltanaClient();
      const { wallet, session, sessionKey } = await client.grant({
        permissions: sdkPermissions,
        expirySeconds,
      });

      const res = await fetch("/api/mandates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet.address,
          agentId,
          category,
          capUsd,
          expirySeconds,
          sessionPublicKey: session.publicKey,
          sessionSigner: sessionKey,
          permissions: serializablePermissions,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "failed to save mandate");
      }
      setWalletAddress(wallet.address);
      setPhase("done");
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setPhase("error");
    }
  }

  if (phase === "done") {
    return (
      <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <div className="text-2xl">✓</div>
        <h2 className="mt-2 text-lg font-semibold text-emerald-900">{agentName} is hired</h2>
        <p className="mt-1 text-sm text-emerald-800">
          A capped, revocable session is live on your wallet. You can revoke it any time, and
          every action it takes is validated and receipted.
        </p>
        <button
          onClick={() => router.push(`/watch/${walletAddress}`)}
          className="mt-6 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm text-white hover:bg-emerald-600"
        >
          View receipts
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Set your limits</h2>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs text-zinc-500">Daily spend cap (USD)</span>
          <input
            type="number"
            min={1}
            value={capUsd}
            onChange={(e) => setCapUsd(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Expires in</span>
          <select
            value={expirySeconds}
            onChange={(e) => setExpirySeconds(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
          >
            <option value={Math.floor(Date.now() / 1000) + 7 * 24 * 3600}>7 days</option>
            <option value={Math.floor(Date.now() / 1000) + 30 * 24 * 3600}>30 days</option>
            <option value={Math.floor(Date.now() / 1000) + 90 * 24 * 3600}>90 days</option>
          </select>
        </label>
      </div>

      <button
        onClick={grant}
        disabled={phase === "prompting" || phase === "granting"}
        className="mt-5 w-full rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
      >
        {phase === "prompting" ? "Confirm in your device…" : "Approve with passkey"}
      </button>

      <p className="mt-3 text-xs text-zinc-400">
        Uses Face ID / Touch ID (WebAuthn). No seed phrase. The session key is scoped to exactly
        what&apos;s shown above and registered in Altana&apos;s public Keystore.
      </p>

      {phase === "error" && (
        <p className="mt-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
    </div>
  );
}
