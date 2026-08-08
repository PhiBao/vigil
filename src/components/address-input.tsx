"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

/** The single address input. Paste a BSC address, press enter. */
export function AddressInput() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  function submit() {
    const v = value.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(v)) {
      setError("That doesn't look like a BSC address (0x + 40 hex characters).");
      return;
    }
    setError(null);
    router.push(`/scan/${v}`);
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex gap-2"
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0x…"
          autoFocus
          spellCheck={false}
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm font-mono shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
          aria-label="BSC wallet address"
        />
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-5 py-3 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-400"
        >
          Scan
        </button>
      </form>
      {error && <p className="mt-2 text-left text-xs text-red-600">{error}</p>}
    </div>
  );
}
