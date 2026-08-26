import Link from "next/link";
import { getAgent } from "@/registry/queries";
import { renderMandate } from "@/mandate/permissions";
import type { Category } from "@/registry/model";
import { HireConsent } from "@/components/hire-consent";

export const metadata = {
  title: "Hire agent — Vigil",
};

export const dynamic = "force-dynamic";

export default async function HirePage({
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

  const primary = (agent.categories ?? [])[0] as Category | undefined;
  if (!primary) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center text-zinc-600">
        This agent has no verified capability yet — it cannot be hired until it is classified.
      </div>
    );
  }

  const capUsd = 100;
  const expirySeconds = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  const mandate = renderMandate(primary, capUsd);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-2xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight text-lg hover:text-zinc-600">Vigil</Link>
          <Link href={`/agent/${encodeURIComponent(agent.agentId)}`} className="text-xs text-zinc-500 hover:text-zinc-800">← agent details</Link>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Hire {agent.name}</h1>
        <p className="mt-2 text-sm text-zinc-600">
          This agent runs on <span className="font-medium">its own infrastructure</span>. Hiring it
          means giving it a scoped permission on <span className="font-medium">your</span> wallet,
          capped and revocable. It proposes actions; your session decides — and the cap is enforced
          onchain, not by Vigil.
        </p>
        <p className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          After approving you&apos;ll also get a one-time <span className="font-medium">run token</span> and a
          copy-paste request — hand both to a cron job or AI operator to let the agent run for you
          unattended, inside these same caps. Revoking ends it instantly.
        </p>

        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            What it&apos;s allowed to do (category: {primary.replace(/_/g, " ")})
          </h2>
          <ul className="mt-3 space-y-2">
            {mandate.may.map((m) => (
              <li key={m} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 text-emerald-600">✓</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>

          <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-zinc-400">It cannot</h2>
          <ul className="mt-3 space-y-2">
            {mandate.mayNot.map((m) => (
              <li key={m} className="flex items-start gap-2 text-sm text-zinc-600">
                <span className="mt-0.5 text-red-500">✕</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>

          <p className="mt-5 text-xs text-zinc-400">
            Limits are enforced onchain (Altana session). Its calldata is validated before
            sending: target allowlist, selector check, no off-protocol approvals, and a live
            simulation. The session key is registered in the public Keystore and revocable in one
            click.
          </p>
        </div>

        <HireConsent
          agentId={agent.agentId}
          agentName={agent.name}
          category={primary}
          defaultCapUsd={capUsd}
          defaultExpirySeconds={expirySeconds}
        />
      </main>
    </div>
  );
}
