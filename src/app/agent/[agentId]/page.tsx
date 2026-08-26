import Link from "next/link";
import { getAgent } from "@/registry/queries";

export const metadata = {
  title: "Agent — Vigil",
};

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId: raw } = await params;
  const agentId = decodeURIComponent(raw);
  const agent = await getAgent(agentId);

  if (!agent) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-600">Agent not found in the index.</p>
          <Link href="/browse" className="mt-4 inline-block text-sm text-sky-600 hover:underline">← browse agents</Link>
        </div>
      </div>
    );
  }

  const hireable = Boolean((agent as any).x402 && (agent as any).services?.mcp && (agent as any).verifiedAt);
  const verifiedTools = (agent as any).services?.mcp?.verified ?? [];
  const declaredTools = (agent as any).services?.mcp?.tools ?? [];

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight text-lg hover:text-zinc-600">Vigil</Link>
          <Link href="/browse" className="text-xs text-zinc-500 hover:text-zinc-800">← browse</Link>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{agent.name}</h1>
            <div className="mt-1 text-xs text-zinc-500">
              <span className="font-mono">{agent.chainId}:{agent.tokenId}</span> · owner{" "}
              <span className="font-mono">{agent.owner.slice(0, 10)}…{agent.owner.slice(-6)}</span>
            </div>
          </div>
          {hireable && (
            <Link
              href={`/hire/${encodeURIComponent(agent.agentId)}`}
              className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600"
            >
              Hire this agent
            </Link>
          )}
        </div>

        {agent.description && (
          <p className="mt-4 text-sm text-zinc-700">{agent.description}</p>
        )}

        {/* Classification evidence */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Why it&apos;s in these categories</h2>
          {Object.entries(agent.categoryReasons ?? {}).some(([, reasons]) => (reasons as string[]).length > 0) ? (
            <div className="mt-3 grid grid-cols-1 gap-3">
              {Object.entries(agent.categoryReasons ?? {})
                .filter(([, reasons]) => (reasons as string[]).length > 0)
                .map(([cat, reasons]) => (
                  <div key={cat} className="rounded-lg border border-zinc-200 bg-white p-4">
                    <div className="text-sm font-medium capitalize">{cat.replace(/_/g, " ")}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(reasons as string[]).map((r) => (
                        <span key={r} className={`rounded px-2 py-1 font-mono text-[11px] ${r.startsWith("desc:") ? "bg-amber-50 border border-amber-200 text-amber-700" : "bg-zinc-100 text-zinc-600"}`}>{r}</span>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-zinc-500">
              No category yet — none of its verified tools match a capability rule. Vigil does not
              guess from marketing copy.
            </p>
          )}

          {(agent.claimedOnly ?? []).length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-medium text-amber-900">Publisher claims, unverified</div>
              <p className="mt-1 text-xs text-amber-800">
                The description advertises these capabilities, but no verified tool signature
                supports them. Shown here rather than silently trusted.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {agent.claimedOnly.map((c) => (
                  <span key={c} className="rounded bg-white border border-amber-300 px-2 py-1 text-[11px] capitalize text-amber-800">{c.replace(/_/g, " ")}</span>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Verified capability */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Verified tools {verifiedTools.length > 0 ? `(${verifiedTools.length})` : ""}
          </h2>
          {verifiedTools.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {verifiedTools.map((t: string) => (
                <span key={t} className="rounded bg-emerald-50 border border-emerald-200 px-2 py-1 font-mono text-[11px] text-emerald-800">{t}</span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-zinc-500">
              {declaredTools.length > 0
                ? `Declared ${declaredTools.length} tools but not yet live-verified.`
                : "No tool list recorded yet. Verification runs in the background."}
            </p>
          )}
        </section>

        {/* Status */}
        <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-5 grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-zinc-400">Endpoint status</div>
            <div className="mt-1 font-medium capitalize">{agent.healthStatus ?? "unknown"}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-400">Uptime</div>
            <div className="mt-1 font-medium">
              {agent.uptimeChecks > 0 ? `${agent.uptimeOk}/${agent.uptimeChecks} passed` : "no checks yet"}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-400">Payment</div>
            <div className="mt-1 font-medium">{agent.x402 ? "x402 (pay per call)" : "not x402"}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-400">Protocols</div>
            <div className="mt-1 font-medium">{agent.protocols.join(", ") || "—"}</div>
          </div>
        </section>

        <p className="mt-6 text-xs text-zinc-400">
          This page is built from live verification, not the agent&apos;s self-description.
          Classification shows the exact tool signatures that placed it. Uptime and freshness
          are measured continuously by Vigil.
        </p>
      </main>
    </div>
  );
}
