"use client";

import { useState, useEffect } from "react";
import { AltanaClient } from "@/lib/altana-client";

interface MandateRow {
  id: string;
  agent: string;
  agentId: string;
  category?: string;
  capUsd: number;
  expirySeconds: number;
  status: string;
  createdAt: Date;
}

interface ReceiptRow {
  id: string;
  agentId: string;
  event: string;
  detail: Record<string, unknown>;
  txHash: string | null;
  createdAt: Date;
}

export function WatchView({
  address,
  dbOk,
  mandates,
  receipts,
}: {
  address: string;
  dbOk: boolean;
  mandates: MandateRow[];
  receipts: ReceiptRow[];
}) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  if (!dbOk) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
        <h1 className="text-lg font-semibold">No active agents yet</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Your first receipt will appear here. Hiring an agent from a scan is all it takes.
        </p>
      </div>
    );
  }

  // Deduplicate mandates by agentId — keep latest per agent (avoids duplicate lines after retry)
  const active = (() => {
    const seen = new Map<string, (typeof mandates)[number]>();
    for (const m of mandates.filter((m) => m.status === "active")) {
      if (!seen.has(m.agentId)) seen.set(m.agentId, m);
    }
    return Array.from(seen.values());
  })();

  // Deduplicate receipts by id and by txHash (prevents duplicate lines from retry)
  const uniqueReceipts = (() => {
    const byId = new Map<string, (typeof receipts)[number]>();
    for (const r of receipts) {
      if (!byId.has(r.id)) byId.set(r.id, r);
    }
    // Second pass: dedupe by txHash+event when txHash exists (same on-chain tx inserted twice)
    const byTx = new Map<string, (typeof receipts)[number]>();
    const out: typeof receipts = [];
    for (const r of byId.values()) {
      if (r.txHash) {
        const k = `${r.txHash}:${r.event}`;
        if (!byTx.has(k)) {
          byTx.set(k, r);
          out.push(r);
        }
      } else {
        out.push(r);
      }
    }
    return out;
  })();

  async function revoke(m: MandateRow) {
    setRevoking(m.id);
    setRevokeError(null);
    try {
      const client = new AltanaClient();
      // Need the session public key — fetch it via the mandate record.
      const res = await fetch(`/api/mandates/${m.id}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address }),
      });
      const data = (await res.json()) as { needSigner?: boolean; sessionPublicKey?: string; error?: string };
      if (data.needSigner && data.sessionPublicKey) {
        await client.revoke(address, data.sessionPublicKey);
        await fetch(`/api/mandates/${m.id}/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress: address, confirmed: true }),
        });
      }
      // Clear local hire cache for this agent so hire page doesn't restore a revoked mandate
      try {
        localStorage.removeItem(`vigil:hire:${m.agentId}`);
      } catch {}
      window.location.reload();
    } catch (e: any) {
      setRevokeError(String(e?.message ?? e));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Your watch</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Receipts of what your agents did — nothing else.
      </p>

      {active.length === 0 ? (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6">
          <p className="text-sm text-zinc-600">No active agents. Hire one from a scan.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {active.map((m) => (
            <div key={m.id} className="rounded-xl border border-zinc-200 bg-white p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{m.agent}</div>
                <div className="text-xs text-zinc-500">
                  cap {fmt(m.capUsd)}/day · expires {new Date(m.expirySeconds * 1000).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => revoke(m)}
                disabled={revoking === m.id}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {revoking === m.id ? "Revoking…" : "Revoke"}
              </button>
            </div>
          ))}
          {revokeError && <p className="text-xs text-red-600">{revokeError}</p>}
        </div>
      )}

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-zinc-400">Runners &amp; autonomy</h2>
      {active.length > 0 ? (
        <div className="mt-3 rounded-xl border border-sky-200 bg-white p-5">
          <p className="text-sm text-zinc-700">
            Every hire issues a one-time <span className="font-medium">run token</span> (shown right after
            approving with your passkey). Hand it to your own runner — a cron job, a CLI loop, or an AI
            operator — and it can call your hired agents unattended. The token authenticates but does not
            authorize: each call passes calldata validation, a live simulation, and the onchain spend caps,
            and revoking the mandate above kills it instantly.
          </p>
          <details className="mt-3" open={active.length === 1}>
            <summary className="cursor-pointer text-xs font-medium text-sky-700">
              Show copy-paste request{active.length > 1 ? "s" : ""} ({active.length})
            </summary>
            <div className="mt-2 space-y-2">
              {active.map((m) => {
                const label = m.category ? m.category.replace(/_/g, " ") : "agent";
                const curl = `curl -X POST ${origin || "https://your-vigil-app.vercel.app"}/api/hire \\
  -H "Authorization: Bearer $VIGIL_RUN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": "${m.agentId}",
    "mandateId": "${m.id}",
    "tool": "<tool-name>",
    "args": { },
    "dryRun": true
  }'`;
                return (
                  <div key={m.id} className="relative">
                    <div className="mb-1 text-xs text-zinc-500">
                      {label} · cap ${m.capUsd}/day
                    </div>
                    <pre className="overflow-auto rounded-lg bg-zinc-900 p-3 pr-16 text-[11px] leading-relaxed text-zinc-100">{curl}</pre>
                    <CopyBtn text={curl} />
                  </div>
                );
              })}
            </div>
          </details>
          <p className="mt-3 text-[11px] text-zinc-400">
            Replace <code className="font-mono">$VIGIL_RUN_TOKEN</code> with the token you saved at hire time —
            Vigil stores only its hash and never shows it twice. Lost it? Revoke and re-hire (one biometric
            prompt) to rotate. Tool names + JSON schemas:{" "}
            <a className="text-sky-600 hover:underline" href={`/api/agent/${encodeURIComponent(active[0].agentId)}/tools`}>
              /api/agent/…/tools
            </a>.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">No active hires — autonomy comes with your first agent.</p>
      )}

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-zinc-400">Receipts</h2>
      {uniqueReceipts.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">
          Nothing yet. When an agent acts — or checks in and finds nothing needed — it appears here.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {uniqueReceipts.map((r) => (
            <div key={r.id} className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{r.event}</span>
                <span className="text-xs text-zinc-400">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              {r.txHash && (
                <a
                  href={`https://bscscan.com/tx/${r.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block font-mono text-xs text-sky-600 hover:underline"
                >
                  {r.txHash.slice(0, 14)}…{r.txHash.slice(-8)}
                </a>
              )}
              {r.detail && Object.keys(r.detail).length > 0 && (
                <pre className="mt-1 whitespace-pre-wrap text-xs text-zinc-500">
                  {JSON.stringify(r.detail, null, 0)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {}
      }}
      className="absolute right-2 top-6 rounded border border-zinc-600 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
