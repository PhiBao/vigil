"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AltanaClient } from "@/lib/altana-client";

export interface SerializablePermissions {
  calls: { to: string; signature?: string }[];
  spend: { token?: string; limit: string; period: string }[];
}

type Phase = "form" | "prompting" | "granting" | "done" | "error";

export function MandateConsent({
  address,
  agentId,
  defaultCapUsd,
  defaultExpirySeconds,
  permissions,
  findingId,
}: {
  address: string;
  agentId: string;
  defaultCapUsd: number;
  defaultExpirySeconds: number;
  permissions: SerializablePermissions;
  findingId?: string;
}) {
  const [capUsd, setCapUsd] = useState(defaultCapUsd);
  const [expirySeconds, setExpirySeconds] = useState(defaultExpirySeconds);
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [mandateId, setMandateId] = useState<string | null>(null);
  const router = useRouter();

  async function grant() {
    setPhase("prompting");
    setError(null);
    try {
      const client = new AltanaClient();
      // Reconstruct bigint limits for the SDK call.
      const sdkPermissions = {
        calls: permissions.calls as { to: `0x${string}`; signature?: string }[],
        spend: permissions.spend.map((s) => ({
          limit: BigInt(s.limit),
          period: s.period as "day",
          token: s.token as `0x${string}`,
        })),
      };

      const { session, sessionKey } = await client.grant({
        walletAddress: address,
        permissions: sdkPermissions,
        expirySeconds,
      });

      setPhase("granting");
      const res = await fetch("/api/mandates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          agentId,
          capUsd,
          expirySeconds,
          findingId,
          sessionPublicKey: session.publicKey,
          sessionSigner: sessionKey,
          permissions,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "failed to save mandate");
      }
      const data = (await res.json()) as { id: string };
      setMandateId(data.id);
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
        <h2 className="mt-2 text-lg font-semibold text-emerald-900">Agent is live</h2>
        <p className="mt-1 text-sm text-emerald-800">
          {agentId} is watching your position. The session key is registered onchain and can be
          revoked any time. You&apos;ll see a receipt the moment it does anything.
        </p>
        <div className="mt-4 text-xs text-emerald-700/70">Mandate {mandateId?.slice(0, 8)}</div>
        <button
          onClick={() => router.push(`/watch/${address}`)}
          className="mt-6 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm text-white hover:bg-emerald-600"
        >
          View receipts
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
        Set your limits
      </h2>

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
        {phase === "prompting"
          ? "Confirm in your device…"
          : phase === "granting"
            ? "Registering onchain…"
            : "Approve with passkey"}
      </button>

      <p className="mt-3 text-xs text-zinc-400">
        Uses Face ID / Touch ID (WebAuthn). No seed phrase, no browser extension. The agent&apos;s
        key is separate from yours and scoped to exactly what&apos;s shown above.
      </p>

      {phase === "error" && (
        <p className="mt-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
