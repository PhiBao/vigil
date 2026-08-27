"use client";

import { useState, useEffect } from "react";

interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, any>; required?: string[] };
}

const DEMO_ADDRESS = "0x28C6c06298d514Db089934071355E5743bf21d60";

/** Shared arg-prefill logic with the hire flow, tuned for curiosity instead of execution. */
export function prefillArgs(tool: ToolDef | undefined): Record<string, unknown> {
  const props = tool?.inputSchema?.properties ?? {};
  const required = tool?.inputSchema?.required ?? Object.keys(props);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(props)) {
    const p = props[k] ?? {};
    if (p.enum && p.enum.length) out[k] = p.enum[0];
    else if (/addr|wallet|account|holder|user/i.test(k)) out[k] = DEMO_ADDRESS;
    else if (/chain/i.test(k)) out[k] = "bsc";
    else if (/pool$/i.test(k)) out[k] = "CORE";
    else if (/token/i.test(k)) out[k] = Array.isArray(p.type) || k.endsWith("s") ? ["USDT"] : "USDT";
  }
  // Make sure every REQUIRED key exists.
  for (const k of required) {
    if (!(k in out)) {
      if (/addr|wallet|account|holder|user/i.test(k)) out[k] = DEMO_ADDRESS;
      else if (/chain/i.test(k)) out[k] = "bsc";
      else out[k] = "";
    }
  }
  return out;
}

/**
 * Try-it-live panel on the agent page. No wallet, no gas, no mandate — one
 * server-proxied MCP call to the verified endpoint, displayed inertly. This
 * removes the last dead end from browse → understand → *experience* → hire.
 */
export function TryPanel({ agentId }: { agentId: string }) {
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [argsJson, setArgsJson] = useState("{}");
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<any>(null);
  const [live, setLive] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(agentId)}/tools`);
        const data = await res.json();
        if (cancelled) return;
        const list: ToolDef[] = data.tools ?? [];
        setTools(list);
        setLive(data.live !== false);
        if (list.length > 0) {
          setSelected(list[0].name);
          setArgsJson(JSON.stringify(prefillArgs(list[0]), null, 2));
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  function pick(name: string) {
    setSelected(name);
    const t = tools.find((x) => x.name === name);
    setArgsJson(JSON.stringify(prefillArgs(t), null, 2));
  }

  async function run() {
    if (!selected) return;
    setPhase("running");
    setResult(null);
    try {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(argsJson);
      } catch {
        throw new Error("args is not valid JSON");
      }
      const res = await fetch("/api/try", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, tool: selected, args }),
      });
      const data = await res.json();
      setResult(data);
      setPhase(data.ok ? "done" : "error");
    } catch (e: any) {
      setResult({ ok: false, error: String(e?.message ?? e) });
      setPhase("error");
    }
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Try it live — no wallet needed</h3>
        <span className="rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[11px] text-sky-700">free preview</span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        One real call to this agent&apos;s endpoint through Vigil&apos;s proxy. Results are shown
        as data only — nothing is ever executed. Hire to grant a scoped session for real actions.
      </p>
      {!live && (
        <p className="mt-2 text-xs text-amber-700">
          Live schema probe failed just now; showing the stored verified list instead.
        </p>
      )}
      {tools.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">Loading tools…</p>
      ) : (
        <>
          <label className="mt-4 block">
            <span className="text-xs text-zinc-500">Tool ({tools.length} verified)</span>
            <select
              value={selected}
              onChange={(e) => pick(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            >
              {tools.map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
            {tools.find((t) => t.name === selected)?.description && (
              <span className="mt-1 block text-xs text-zinc-400 line-clamp-2">
                {tools.find((t) => t.name === selected)?.description}
              </span>
            )}
          </label>
          <label className="mt-3 block">
            <span className="text-xs text-zinc-500">Arguments (JSON)</span>
            <textarea
              value={argsJson}
              onChange={(e) => setArgsJson(e.target.value)}
              rows={5}
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs"
            />
          </label>
          <button
            onClick={run}
            disabled={phase === "running"}
            className="mt-3 w-full rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
          >
            {phase === "running" ? "Calling agent…" : "Run it"}
          </button>
          {result && (
            <pre
              className={`mt-3 max-h-72 overflow-auto rounded-lg p-3 text-xs ${
                result.ok
                  ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
                  : "bg-red-50 text-red-800 border border-red-200"
              }`}
            >
              {result.text ?? JSON.stringify(result, null, 2)}
              {result.truncated ? "\n… (truncated)" : ""}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
