"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AltanaClient } from "@/lib/altana-client";
import { buildPermissions } from "@/mandate/permissions";
import type { Category } from "@/registry/model";

type Phase = "form" | "prompting" | "granting" | "done" | "error";

interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, any>; required?: string[] };
}

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
  const [mandateId, setMandateId] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [selectedTool, setSelectedTool] = useState<string>("");
  const [argsJson, setArgsJson] = useState("{}");
  const [execPhase, setExecPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [execResult, setExecResult] = useState<any>(null);
  const router = useRouter();

  async function grant() {
    setPhase("prompting");
    setError(null);
    try {
      if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error("invalid cap");
      // Single source of truth: buildPermissions derives both calls and spend (incl. WBNB + native).
      const perms = buildPermissions(category, {
        capUsd,
        expirySeconds,
        walletAddress: "0x0000000000000000000000000000000000000000",
      });
      const sdkPermissions = {
        calls: (perms.calls ?? []).map((c: any) => ({ to: c.to as `0x${string}`, ...(c.signature ? { signature: c.signature } : {}) })),
        spend: (perms.spend ?? []).map((s: any) => ({
          ...(s.token ? { token: s.token as `0x${string}` } : {}),
          limit: s.limit as bigint,
          period: s.period as "day",
        })),
      };
      const serializablePermissions = {
        calls: (perms.calls ?? []).map((c: any) => ({ to: c.to })),
        spend: (perms.spend ?? []).map((s: any) => ({
          ...(s.token ? { token: s.token } : {}),
          limit: String(s.limit),
          period: s.period,
        })),
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
        // Compensating: if persistence fails we leave an onchain session orphaned.
        // Surface the need to revoke and keep the session key for manual cleanup.
        throw new Error(body?.error ?? "failed to save mandate — session was granted onchain, revoke via Altana if needed");
      }
      const data = await res.json();
      setWalletAddress(wallet.address);
      setMandateId(data.id);
      setPhase("done");
      // Fetch tools for execution
      fetchTools(agentId);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setPhase("error");
    }
  }

  async function fetchTools(id: string) {
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(id)}/tools`);
      const data = await res.json();
      const list: ToolDef[] = data.tools ?? [];
      setTools(list);
      if (list.length > 0) {
        setSelectedTool(list[0].name);
        // Prefill args with required fields
        const t = list[0];
        const props = t.inputSchema?.properties ?? {};
        const required = t.inputSchema?.required ?? Object.keys(props);
        const sample: Record<string, any> = {};
        for (const k of required) {
          if (k === "userAddress" || k === "wallet") sample[k] = walletAddress ?? "0x0000000000000000000000000000000000000000";
          else if (k === "chainName") sample[k] = "bsc";
          else if (k === "pool") sample[k] = "CORE";
          else if (k === "tokenSymbol" || k === "tokenSymbols") sample[k] = k === "tokenSymbols" ? ["USDT"] : "USDT";
          else sample[k] = "";
        }
        setArgsJson(JSON.stringify(sample, null, 2));
      }
    } catch {}
  }

  async function executeTool(dryRun: boolean) {
    if (!mandateId || !selectedTool) return;
    setExecPhase("running");
    setExecResult(null);
    try {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(argsJson);
      } catch {
        throw new Error("args is not valid JSON");
      }
      const res = await fetch("/api/hire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, mandateId, tool: selectedTool, args, dryRun }),
      });
      const data = await res.json();
      setExecResult(data);
      setExecPhase(data.ok ? "done" : "error");
    } catch (e: any) {
      setExecResult({ ok: false, error: String(e?.message ?? e) });
      setExecPhase("error");
    }
  }

  if (phase === "done" && walletAddress && mandateId) {
    return (
      <div className="mt-6 space-y-6">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <div className="text-2xl">✓</div>
          <h2 className="mt-2 text-lg font-semibold text-emerald-900">{agentName} is hired</h2>
          <p className="mt-1 text-sm text-emerald-800">
            A capped, revocable session is live on your wallet. You can revoke it any time, and every action it takes is validated and receipted.
          </p>
          <div className="mt-3 font-mono text-xs text-emerald-700">
            {walletAddress.slice(0, 10)}…{walletAddress.slice(-8)} · cap ${capUsd}/day · {new Date(expirySeconds * 1000).toLocaleDateString()}
          </div>
          <div className="mt-4 flex justify-center gap-3">
            <button
              onClick={() => router.push(`/watch/${walletAddress}`)}
              className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm text-white hover:bg-emerald-600"
            >
              View receipts
            </button>
            <a href={`/agent/${encodeURIComponent(agentId)}`} className="rounded-lg border border-emerald-300 px-5 py-2.5 text-sm text-emerald-800 hover:bg-emerald-100">
              Back to agent
            </a>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <h3 className="text-sm font-semibold">Try a tool</h3>
          <p className="mt-1 text-xs text-zinc-500">Call the agent&apos;s MCP tool, validate its calldata, and execute under your session. Read tools return data; write tools go through the full validation + session execution path.</p>
          {tools.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">Loading tools…</p>
          ) : (
            <>
              <label className="mt-4 block">
                <span className="text-xs text-zinc-500">Tool</span>
                <select
                  value={selectedTool}
                  onChange={(e) => {
                    setSelectedTool(e.target.value);
                    const t = tools.find((x) => x.name === e.target.value);
                    if (t?.inputSchema?.properties) {
                      const sample: Record<string, any> = {};
                      for (const k of t.inputSchema.required ?? Object.keys(t.inputSchema.properties)) {
                        if (k === "userAddress" || k === "wallet") sample[k] = walletAddress;
                        else if (k === "chainName") sample[k] = "bsc";
                        else if (k === "pool") sample[k] = "CORE";
                        else if (k === "tokenSymbols") sample[k] = ["USDT"];
                        else sample[k] = "";
                      }
                      setArgsJson(JSON.stringify(sample, null, 2));
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                >
                  {tools.map((t) => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))}
                </select>
                {tools.find((t) => t.name === selectedTool)?.description && (
                  <span className="mt-1 block text-xs text-zinc-400">{tools.find((t) => t.name === selectedTool)?.description}</span>
                )}
              </label>
              <label className="mt-4 block">
                <span className="text-xs text-zinc-500">Args (JSON)</span>
                <textarea
                  value={argsJson}
                  onChange={(e) => setArgsJson(e.target.value)}
                  rows={5}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs"
                  placeholder='{"userAddress":"0x...","chainName":"bsc"}'
                />
              </label>
              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => executeTool(true)}
                  disabled={execPhase === "running"}
                  className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
                >
                  {execPhase === "running" ? "Running…" : "Simulate (dry run)"}
                </button>
                <button
                  onClick={() => executeTool(false)}
                  disabled={execPhase === "running"}
                  className="flex-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
                >
                  Execute
                </button>
              </div>
              {execResult && (
                <pre className={`mt-4 rounded-lg p-3 text-xs overflow-auto max-h-64 ${execResult.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-900" : "bg-red-50 border border-red-200 text-red-800"}`}>
                  {JSON.stringify(execResult, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
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
