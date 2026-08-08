"use client";

import { useState } from "react";
import { AltanaClient } from "@/lib/altana-client";

interface MandateRow {
  id: string;
  agent: string;
  agentId: string;
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

  const active = mandates.filter((m) => m.status === "active");

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

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-zinc-400">Receipts</h2>
      {receipts.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">
          Nothing yet. When an agent acts — or checks in and finds nothing needed — it appears here.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {receipts.map((r) => (
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
