import Link from "next/link";
import { CATEGORIES, type Category } from "@/registry/model";
import { categoryCounts, totalIndexed } from "@/registry/queries";

export const metadata = {
  title: "Browse agents — Vigil",
};

export const dynamic = "force-dynamic";

export default async function BrowsePage() {
  const counts = await categoryCounts();
  const total = await totalIndexed();

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight text-lg hover:text-zinc-600">Vigil</Link>
          <span className="text-xs text-zinc-500">Agent marketplace · {total} indexed on BSC</span>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Browse agents</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Every agent below was indexed from BSC&apos;s ERC-8004 registry and classified by what
          its tools actually do — not by its description. Verification runs in the background,
          so unverified agents are shown honestly as unverified.
        </p>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {CATEGORIES.map((c) => (
            <Link
              key={c.id}
              href={`/browse/${c.id}`}
              className="group rounded-xl border border-zinc-200 bg-white p-6 hover:border-zinc-400 hover:shadow-sm transition"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-lg">{c.label}</h2>
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600">
                  {counts[c.id] ?? 0} indexed
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-600">{c.hint}</p>
              <span className="mt-4 inline-block text-sm text-zinc-500 group-hover:text-zinc-900">
                Browse →
              </span>
            </Link>
          ))}
        </div>

        <p className="mt-10 text-xs text-zinc-400">
          Classification is deterministic and auditable — each agent shows the exact tool
          signatures that placed it in its category. Capability is confirmed by live endpoint
          checks, which we run continuously.
        </p>
      </main>
    </div>
  );
}
