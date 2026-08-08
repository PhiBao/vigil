"use client";

import type { Finding, FindingAgent } from "./scan-view";
import { fmtUsd } from "./scan-view";

const SEVERITY_STYLES: Record<string, { dot: string; label: string }> = {
  critical: { dot: "bg-red-500", label: "text-red-700" },
  warning: { dot: "bg-amber-500", label: "text-amber-700" },
  info: { dot: "bg-sky-500", label: "text-sky-700" },
};

export function FindingCard({ finding, address }: { finding: Finding; address: string }) {
  const sev = SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.info;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <span className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${sev.dot}`} />
          <div className="flex-1">
            <h2 className="font-medium leading-snug">{finding.title}</h2>
            <p className="mt-1 text-sm text-zinc-600">{finding.detail}</p>
            {(finding.dollarsAtRisk !== undefined || finding.opportunityPerYear !== undefined) && (
              <div className="mt-3 flex gap-4 text-sm">
                {finding.dollarsAtRisk !== undefined && finding.dollarsAtRisk > 0 && (
                  <span className="font-medium text-red-600">
                    ≈ {fmtUsd(finding.dollarsAtRisk)} at risk
                  </span>
                )}
                {finding.opportunityPerYear !== undefined && finding.opportunityPerYear > 0 && (
                  <span className="font-medium text-emerald-700">
                    +{fmtUsd(finding.opportunityPerYear)}/yr
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {finding.agents.length > 0 && (
        <div className="border-t border-zinc-100 bg-zinc-50/50 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            Agents that fix this
          </p>
          <div className="mt-2 space-y-2">
            {finding.agents.map((a) => (
              <AgentRow key={a.id} agent={a} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentRow({ agent }: { agent: FindingAgent }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white text-xs font-semibold">
            {agent.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{agent.name}</div>
            <div className={`text-xs ${agent.verified ? "text-emerald-700" : "text-zinc-400"}`}>
              {agent.verified ? "Verified — live endpoint checked" : "Not yet verified"}
              {agent.freshness ? ` · ${agent.freshness}` : ""}
            </div>
          </div>
        </div>
        <a
          href={`/agent/${encodeURIComponent(agent.id)}`}
          className="shrink-0 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-700"
        >
          View agent
        </a>
      </div>
      <p className="mt-2 text-xs text-zinc-600 line-clamp-2">{agent.tagline}</p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>{agent.category.join(" · ")}</span>
        {agent.uptimeChecks > 0 && (
          <span>
            {agent.uptimeOk}/{agent.uptimeChecks} checks passed
          </span>
        )}
        {agent.x402 && <span className="text-emerald-700">x402 payable</span>}
      </div>
    </div>
  );
}
