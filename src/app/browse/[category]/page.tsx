import Link from "next/link";
import { CATEGORIES, type Category } from "@/registry/model";
import { agentsForCategory } from "@/registry/queries";

export const metadata = {
  title: "Browse — Vigil",
};

export const dynamic = "force-dynamic";

const CATEGORY_TITLES: Record<Category, { title: string; blurb: string }> = {
  health_factor: {
    title: "Health factor agents",
    blurb: "Track lending positions and act before liquidation — repay debt, manage collateral, keep the position safe.",
  },
  rebalancing: {
    title: "Rebalancing agents",
    blurb: "Manage LP ranges and reset positions automatically so concentrated liquidity keeps earning.",
  },
  yield: {
    title: "Yield agents",
    blurb: "Route capital to where it earns most and keep it compounding across BSC yield protocols.",
  },
  grid: {
    title: "Grid trading agents",
    blurb: "Run automated strategies within set ranges — bounded, mechanical, on your terms.",
  },
  monitoring: {
    title: "Monitoring agents",
    blurb: "Watch markets, wallets, and positions and alert you — read-only, no fund access.",
  },
};

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: Category }>;
}) {
  const { category } = await params;
  const meta = CATEGORY_TITLES[category];
  if (!meta) {
    return <div className="min-h-screen bg-zinc-50 flex items-center justify-center text-zinc-600">Unknown category.</div>;
  }

  const agents = await agentsForCategory(category);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight text-lg hover:text-zinc-600">Vigil</Link>
          <Link href="/browse" className="text-xs text-zinc-500 hover:text-zinc-800">← all categories</Link>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold">{meta.title}</h1>
        <p className="mt-1 text-sm text-zinc-600">{meta.blurb}</p>

        {agents.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center">
            <p className="text-sm text-zinc-600">
              No agents verified in this category yet. Verification runs continuously — this
              shelf will fill as the index grows.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
            {agents.map((a) => (
              <AgentCard key={a.agentId} agent={a} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function AgentCard({ agent }: { agent: any }) {
  const hireable = Boolean(agent.x402 && agent.services?.mcp && agent.verifiedAt);
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{agent.name}</div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {agent.verifiedAt ? "Verified endpoint" : "Not yet verified"}
            {agent.verifiedAt ? ` · ${fmtFresh(agent.verifiedAt)}` : ""}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            hireable ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-500"
          }`}
        >
          {hireable ? "Hireable" : agent.x402 ? "x402" : "Listed"}
        </span>
      </div>
      <p className="mt-2 text-xs text-zinc-600 line-clamp-3">{agent.description || agent.name}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(agent.services?.mcp?.verified ?? agent.services?.mcp?.tools ?? []).slice(0, 5).map((t: string) => (
          <span key={t} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">{t}</span>
        ))}
        {(agent.services?.mcp?.tools?.length ?? 0) > 5 && (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-400">
            +{(agent.services.mcp.tools.length - 5)} more
          </span>
        )}
      </div>
      {agent.uptimeChecks > 0 && (
        <div className="mt-2 text-[11px] text-zinc-400">
          {agent.uptimeOk}/{agent.uptimeChecks} checks passed
        </div>
      )}
      <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between">
        <div className="text-[11px] text-zinc-400">
          {agent.categories?.join(" · ")}
        </div>
        <Link
          href={`/agent/${encodeURIComponent(agent.agentId)}`}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700"
        >
          Details
        </Link>
      </div>
    </div>
  );
}

function fmtFresh(iso: string): string {
  const hrs = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hrs < 1) return "checked <1h ago";
  if (hrs < 24) return `checked ${Math.round(hrs)}h ago`;
  return `checked ${Math.round(hrs / 24)}d ago`;
}
