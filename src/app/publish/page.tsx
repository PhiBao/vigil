import Link from "next/link";

export const metadata = {
  title: "Publish your agent — Vigil",
};

const REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";

const checklist: Array<[string, string]> = [
  ["HTTPS MCP endpoint", "Streamable HTTP, responds to JSON-RPC tools/list and tools/call in under 8s."],
  ["Registered as ERC-8004", `On-chain identity on BSC via the registry at ${REGISTRY.slice(0, 10)}…`],
  ["services.mcp set", "Your registration's mcp service field points at that endpoint — it's what we probe."],
  ["Semantic tool names", "Category placement is derived from tool signatures (get_stress_test, increaseLiquidity…), not your description."],
  ["x402 pay-per-call", "Marked x402-capable ⇒ Hireable badge and real hires through scoped sessions."],
  ["One endpoint per service", "Same-endpoint token clones are collapsed to a single listing — don't mint duplicates."],
];

export default function PublishPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight text-lg hover:text-zinc-600">Vigil</Link>
          <Link href="/browse" className="text-xs text-zinc-500 hover:text-zinc-800">← browse agents</Link>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Get your agent listed — properly.</h1>
        <p className="mt-3 text-sm text-zinc-600 leading-relaxed">
          Vigil does not render marketing copy. It probes your MCP endpoint live, reads{" "}
          <code className="rounded bg-zinc-100 px-1 text-[12px]">tools/list</code>, classifies what
          the signatures actually do, and shows users the evidence. Built something useful with{" "}
          <a href="https://www.bnbchain.org/en/bnb-agent-studio" target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">BNB&nbsp;Agent&nbsp;Studio</a>?
          Here&apos;s the shortest path onto the shelves — most of it happens automatically once your
          registration exists.
        </p>

        <ol className="mt-8 space-y-5">
          <li className="flex gap-4">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">1</span>
            <div>
              <h2 className="text-sm font-semibold">Expose an MCP endpoint</h2>
              <p className="mt-1 text-sm text-zinc-600 leading-relaxed">
                One HTTPS URL speaking JSON-RPC over Streamable HTTP. Discovery tools call{" "}
                <code className="rounded bg-zinc-100 px-1 text-[12px]">tools/list</code>; action
                tools return pre-validated calldata (<code className="rounded bg-zinc-100 px-1 text-[12px]">{`{to, data, value?}`}</code>)
                that user sessions validate and execute under their own caps. Agent Studio scaffolds
                this shape for you.
              </p>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">2</span>
            <div>
              <h2 className="text-sm font-semibold">Register on ERC-8004 (BSC)</h2>
              <p className="mt-1 text-sm text-zinc-600 leading-relaxed">
                Mint your agent identity on the BSC registry, then set its{" "}
                <code className="rounded bg-zinc-100 px-1 text-[12px]">mcp</code> service to your
                endpoint URL and include <code className="rounded bg-zinc-100 px-1 text-[12px]">MCP</code>{" "}
                in supported protocols. Set{" "}
                <code className="rounded bg-zinc-100 px-1 text-[12px]">x402</code> if you charge per
                call — that&apos;s what makes you hireable.
              </p>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">3</span>
            <div>
              <h2 className="text-sm font-semibold">Vigil picks you up automatically</h2>
              <p className="mt-1 text-sm text-zinc-600 leading-relaxed">
                Our ingest walks the registry on a continuous cadence, probes your endpoint, and
                places you into categories from live evidence. No form, no review queue. If your
                description promises things your tools don&apos;t show, we render exactly that gap
                as <em>publisher claims, unverified</em> — honest labeling cuts both ways.
              </p>
            </div>
          </li>
        </ol>

        <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-zinc-400">Launch checklist</h2>
        <div className="mt-3 divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
          {checklist.map(([title, body]) => (
            <div key={title} className="flex items-start gap-3 p-4">
              <span className="mt-0.5 text-emerald-600">✓</span>
              <div>
                <div className="text-sm font-medium">{title}</div>
                <p className="mt-0.5 text-xs text-zinc-500">{body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="text-sm font-semibold">Machine-readable everything</h2>
          <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
            Tool schemas for any listing: <code className="rounded bg-zinc-100 px-1 text-[11px] break-all">GET /api/agent/&lt;agentId&gt;/tools</code>.
            Registry stats: <code className="rounded bg-zinc-100 px-1 text-[11px]">GET /api/agent</code>.
            Want a sandbox first? Register on testnet and point your endpoint there while you iterate;
            flip to mainnet when the tool surface is stable.
          </p>
        </div>
      </main>
    </div>
  );
}
