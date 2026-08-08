import { isAddress } from "viem";
import Link from "next/link";
import { store } from "@/db";
import { WatchView } from "@/components/watch-view";

export const metadata = {
  title: "Watch — Vigil",
};

export const dynamic = "force-dynamic";

export default async function WatchPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  const valid = isAddress(address);

  if (!valid) {
    return <div className="min-h-screen bg-zinc-50 flex items-center justify-center text-zinc-600">Invalid address.</div>;
  }

  let dbOk = false;
  let mandates: any[] = [];
  let receipts: any[] = [];
  try {
    const s = store();
    dbOk = true;
    mandates = await s.listMandates(address);
    receipts = await s.listReceipts(address, 50);
  } catch {
    dbOk = false;
  }

  const mandateRows = mandates.map((m) => ({
    id: m.id,
    agent: m.agentId,
    agentId: m.agentId,
    category: m.category,
    capUsd: m.capUsd,
    expirySeconds: m.expirySeconds,
    status: m.status,
    createdAt: m.createdAt,
  }));

  const receiptRows = receipts.map((r) => ({
    id: r.id,
    agentId: r.agentId,
    event: r.event,
    detail: r.detail,
    txHash: r.txHash,
    createdAt: r.createdAt,
  }));

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight text-lg hover:text-zinc-600">Vigil</Link>
          <span className="font-mono text-xs text-zinc-500">
            {address.slice(0, 8)}…{address.slice(-6)}
          </span>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-3xl px-6 py-10">
        <WatchView
          address={address}
          dbOk={dbOk}
          mandates={mandateRows}
          receipts={receiptRows}
        />
      </main>
    </div>
  );
}
