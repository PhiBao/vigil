import Link from "next/link";

export function InvalidAddress({ address }: { address: string }) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex items-center justify-center">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">That address doesn&apos;t parse</h1>
        <p className="mt-2 text-sm text-zinc-600">
          <span className="font-mono break-all">{address}</span> isn&apos;t a valid BSC address
          (0x + 40 hex characters).
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700"
        >
          Try another address
        </Link>
      </div>
    </div>
  );
}
