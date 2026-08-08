"use client";

import { useEffect, useState, useCallback } from "react";
import { FindingCard } from "./finding-card";

export interface FindingAgent {
  id: string;
  name: string;
  tagline: string;
  category: string[];
  verified: boolean;
  healthStatus?: string;
  x402: boolean;
  hireable: boolean;
  freshness?: string;
  uptimeOk: number;
  uptimeChecks: number;
}

export interface Finding {
  id: string;
  category: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  dollarsAtRisk?: number;
  opportunityPerYear?: number;
  agents: FindingAgent[];
}

export interface ScanApiResponse {
  address: string;
  at: string;
  healthy: boolean;
  findings: Finding[];
  totalAtRisk: number;
  totalOpportunityPerYear: number;
  checked: string[];
  hasPositions: boolean;
  summary: {
    venusBorrowUsd: number;
    venusHealthFactor: number | null;
    aaveDebtUsd: number;
    v3OutOfRangeUsd: number;
    idleUsd: number;
  };
}

const PROGRESS_STEPS = ["Venus", "Aave V3", "PancakeSwap V3", "Idle capital"];

export function ScanView({ address }: { address: string }) {
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<ScanApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setStep(0);
    setError(null);
    const ticker = setInterval(() => setStep((s) => Math.min(s + 1, PROGRESS_STEPS.length)), 900);
    try {
      const res = await fetch(`/api/scan?address=${encodeURIComponent(address)}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `scan failed (${res.status})`);
      }
      const data = (await res.json()) as ScanApiResponse;
      setResult(data);
      setState("done");
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setState("error");
    } finally {
      clearInterval(ticker);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      {state === "loading" && (
        <div>
          <h1 className="text-xl font-semibold">Reading positions…</h1>
          <div className="mt-6 space-y-3">
            {PROGRESS_STEPS.map((name, i) => (
              <div
                key={name}
                className={`flex items-center gap-3 text-sm ${
                  i < step ? "text-zinc-400" : i === step ? "text-zinc-900" : "text-zinc-300"
                }`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    i < step ? "bg-emerald-500" : i === step ? "bg-zinc-500 animate-pulse" : "bg-zinc-200"
                  }`}
                />
                {name}
                {i < step && <span className="text-emerald-600">✓</span>}
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs text-zinc-400">
            Read-only. We never see your keys, and nothing is signed.
          </p>
        </div>
      )}

      {state === "error" && (
        <div>
          <h1 className="text-xl font-semibold text-red-600">We couldn&apos;t read that wallet</h1>
          <p className="mt-2 text-sm text-zinc-600">{error}</p>
          <button
            onClick={load}
            className="mt-6 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700"
          >
            Retry
          </button>
        </div>
      )}

      {state === "done" && result && (
        <Results result={result} onRescan={load} />
      )}
    </div>
  );
}

function Results({ result, onRescan }: { result: ScanApiResponse; onRescan: () => void }) {
  const { findings, healthy } = result;

  return (
    <div>
      {healthy ? (
        <HealthyState result={result} onRescan={onRescan} />
      ) : (
        <>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h1 className="text-xl font-semibold">
              {findings.length} thing{findings.length === 1 ? "" : "s"} need attention
            </h1>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              {result.totalAtRisk > 0 && (
                <span className="text-red-600 font-medium">
                  ≈ {fmtUsd(result.totalAtRisk)} at risk
                </span>
              )}
              {result.totalOpportunityPerYear > 0 && (
                <span className="text-emerald-700 font-medium">
                  ≈ {fmtUsd(result.totalOpportunityPerYear)}/yr left on the table
                </span>
              )}
            </div>
            <div className="mt-4 text-xs text-zinc-400">
              Checked: {result.checked.join(" · ")}
            </div>
          </div>

          <div className="mt-6 space-y-5">
            {findings.map((f) => (
              <FindingCard key={f.id} finding={f} address={result.address} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function HealthyState({ result, onRescan }: { result: ScanApiResponse; onRescan: () => void }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
      <div className="text-3xl">✓</div>
      <h1 className="mt-3 text-xl font-semibold text-emerald-900">No problems found</h1>
      <p className="mt-2 text-sm text-emerald-800">
        We checked {result.checked.join(", ")} and found no liquidation risk, no out-of-range
        liquidity, and no meaningful idle capital.
      </p>
      <div className="mt-4 text-xs text-emerald-700/70">
        Scanned at {new Date(result.at).toLocaleTimeString()} · {result.address.slice(0, 8)}…
        {result.address.slice(-6)}
      </div>
      <button
        onClick={onRescan}
        className="mt-6 rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white hover:bg-emerald-600"
      >
        Scan again
      </button>
    </div>
  );
}

export function fmtUsd(n: number): string {
  return (
    "$" +
    n.toLocaleString("en-US", { maximumFractionDigits: 0 })
  );
}
