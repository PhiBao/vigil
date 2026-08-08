import Link from "next/link";
import { AddressInput } from "@/components/address-input";
import { CATEGORIES } from "@/registry/model";
import { categoryCounts, totalIndexed } from "@/registry/queries";

export const metadata = {
  title: "Vigil — the agent marketplace for BNB Smart Chain",
  description:
    "Browse verified AI agents on BSC — health factor protection, LP rebalancing, yield routing, grid trading. Classified by what they do, verified by what they prove.",
};

export const dynamic = "force-dynamic";

export default async function Home() {
  const [counts, total] = await Promise.all([categoryCounts(), totalIndexed()]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <span className="font-semibold tracking-tight text-lg">Vigil</span>
          <nav className="flex items-center gap-5 text-sm text-zinc-600">
            <Link href="/browse" className="hover:text-zinc-900">Browse agents</Link>
            <span className="text-xs text-zinc-400">{total} indexed</span>
          </nav>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-6 py-16">
        <div className="text-center max-w-xl mx-auto">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight">
            Find an agent that fixes your money.
            <br />
            <span className="text-zinc-500">Not one that just describes it.</span>
          </h1>
          <p className="mt-4 text-zinc-600 text-sm sm:text-base">
            Vigil indexes BSC&apos;s ERC-8004 agents and classifies them by the tools they
            actually expose — then verifies the endpoints live. Browse by what they do, or scan
            a wallet to see what you need.
          </p>
        </div>

        <div className="mt-10 rounded-xl border border-zinc-200 bg-white p-6 max-w-xl mx-auto">
          <p className="text-sm font-medium text-zinc-700">Scan a wallet to find what needs fixing</p>
          <div className="mt-3">
            <AddressInput />
          </div>
          <p className="mt-3 text-xs text-zinc-400">
            Works with any public address. Read-only — no connection, no signup.
          </p>
        </div>

        <div className="mt-12">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Browse by category
          </h2>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {CATEGORIES.map((c) => (
              <Link
                key={c.id}
                href={`/browse/${c.id}`}
                className="rounded-xl border border-zinc-200 bg-white p-5 hover:border-zinc-400 hover:shadow-sm transition"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{c.label}</span>
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600">
                    {counts[c.id] ?? 0}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{c.hint}</p>
              </Link>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-200 bg-white py-6">
        <div className="mx-auto max-w-5xl px-6 flex items-center justify-between text-xs text-zinc-400">
          <span>Vigil · Built for the Build the Era hackathon</span>
          <span>Classified by tool signature · verified by live checks</span>
        </div>
      </footer>
    </div>
  );
}
