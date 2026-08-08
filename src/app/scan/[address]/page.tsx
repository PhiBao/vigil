import { isAddress } from "viem";
import Link from "next/link";
import { ScanView } from "@/components/scan-view";
import { InvalidAddress } from "@/components/invalid-address";

export const metadata = {
  title: "Scan — Vigil",
};

export default async function ScanPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  const valid = isAddress(address);

  if (!valid) {
    return <InvalidAddress address={address} />;
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight text-lg hover:text-zinc-600">
            Vigil
          </Link>
          <span className="font-mono text-xs text-zinc-500">
            {address.slice(0, 8)}…{address.slice(-6)}
          </span>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-6 py-10">
        <ScanView address={address} />
      </main>
    </div>
  );
}
