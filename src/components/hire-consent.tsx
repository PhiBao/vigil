"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AltanaClient, isUserCancelError, isNoKeysRegisteredError, isInsufficientFundsError, extractWalletFromNoKeysError, getAltanaChainId } from "@/lib/altana-client";
import { buildPermissions } from "@/mandate/permissions";
import { getPublicClient } from "@/lib/rpc";
import type { Category } from "@/registry/model";

type Phase = "form" | "prompting" | "checking" | "needsFunding" | "granting" | "done" | "error";
type Mode = "recover" | "create";

interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, any>; required?: string[] };
}

export function HireConsent({
  agentId,
  agentName,
  category,
  defaultCapUsd,
  defaultExpirySeconds,
}: {
  agentId: string;
  agentName: string;
  category: Category;
  defaultCapUsd: number;
  defaultExpirySeconds: number;
}) {
  const [capUsd, setCapUsd] = useState(defaultCapUsd);
  const [expirySeconds, setExpirySeconds] = useState(defaultExpirySeconds);
  const [phase, setPhase] = useState<Phase>("form");
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [fundingAddress, setFundingAddress] = useState<string | null>(null);
  const [pendingWallet, setPendingWallet] = useState<{ wallet: any; signer: any; chainId: number } | null>(null);
  const [mandateId, setMandateId] = useState<string | null>(null);
  const [runToken, setRunToken] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [selectedTool, setSelectedTool] = useState<string>("");
  const [argsJson, setArgsJson] = useState("{}");
  const [execPhase, setExecPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [execResult, setExecResult] = useState<any>(null);
  const router = useRouter();

  const chainId = getAltanaChainId();
  const isTestnet = chainId === 97;
  const faucetUrl = isTestnet ? "https://testnet.bnbchain.org/faucet-smart" : "https://www.bnbchain.org/en/testnet-faucet"; // fallback
  const explorerUrl = (addr: string) =>
    isTestnet ? `https://testnet.bscscan.com/address/${addr}` : `https://bscscan.com/address/${addr}`;

  async function fetchTools(id: string) {
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(id)}/tools`);
      const data = await res.json();
      const list: ToolDef[] = data.tools ?? [];
      setTools(list);
      if (list.length > 0) {
        setSelectedTool(list[0].name);
        const t = list[0];
        const props = t.inputSchema?.properties ?? {};
        const required = t.inputSchema?.required ?? Object.keys(props);
        const sample: Record<string, any> = {};
        for (const k of required) {
          if (k === "userAddress" || k === "wallet") sample[k] = walletAddress ?? "0x0000000000000000000000000000000000000000";
          else if (k === "chainName") sample[k] = "bsc";
          else if (k === "pool") sample[k] = "CORE";
          else if (k === "tokenSymbol" || k === "tokenSymbols") sample[k] = k === "tokenSymbols" ? ["USDT"] : "USDT";
          else sample[k] = "";
        }
        setArgsJson(JSON.stringify(sample, null, 2));
      }
    } catch {}
  }

  // Restore last hire for this agent after reload / back navigation
  const storageKey = `vigil:hire:${agentId}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const saved = JSON.parse(raw) as { walletAddress: string; mandateId: string; capUsd: number; expirySeconds: number; runToken?: string };
        if (saved.runToken) setRunToken(saved.runToken);
        if (!saved.walletAddress || !saved.mandateId) return;
        const res = await fetch(`/api/mandates?wallet=${saved.walletAddress}`);
        if (!res.ok) return;
        const data = (await res.json()) as { mandates: Array<{ id: string; status: string }> };
        const stillActive = data.mandates?.some((m) => m.id === saved.mandateId && m.status === "active");
        if (cancelled) return;
        if (!stillActive) {
          localStorage.removeItem(storageKey);
          return;
        }
        setWalletAddress(saved.walletAddress);
        setMandateId(saved.mandateId);
        if (Number.isFinite(saved.capUsd)) setCapUsd(saved.capUsd);
        if (Number.isFinite(saved.expirySeconds)) setExpirySeconds(saved.expirySeconds);
        setPhase("done");
        fetchTools(agentId);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function persistHire(walletAddr: string, mId: string) {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ walletAddress: walletAddr, mandateId: mId, capUsd, expirySeconds, agentId, runToken }));
    } catch {}
  }

  async function checkBalanceAndProceed(wallet: any, signer: any, walletChainId: number) {
    setPendingWallet({ wallet, signer, chainId: walletChainId });
    setFundingAddress(wallet.address);
    // Check balance before attempting on-chain grant — new wallets start at 0 and will fail with 0x
    try {
      setPhase("checking");
      const client = getPublicClient(walletChainId);
      const bal = await client.getBalance({ address: wallet.address as `0x${string}` });
      if (bal === 0n) {
        setPhase("needsFunding");
        return false;
      }
    } catch {
      // If balance check fails (RPC flake), proceed to grant and let it fail with proper error handling
    }
    return true;
  }

  async function doGrant(wallet: any, signer: any, walletChainId: number) {
    setPhase("granting");
    setError(null);
    try {
      if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error("invalid cap");
      const perms = buildPermissions(category, {
        capUsd,
        expirySeconds,
        walletAddress: "0x0000000000000000000000000000000000000000",
      });
      const sdkPermissions = {
        calls: (perms.calls ?? []).map((c: any) => ({ to: c.to as `0x${string}`, ...(c.signature ? { signature: c.signature } : {}) })),
        spend: (perms.spend ?? []).map((s: any) => ({
          ...(s.token ? { token: s.token as `0x${string}` } : {}),
          limit: s.limit as bigint,
          period: s.period as "day",
        })),
      };
      const serializablePermissions = {
        calls: (perms.calls ?? []).map((c: any) => ({ to: c.to })),
        spend: (perms.spend ?? []).map((s: any) => ({
          ...(s.token ? { token: s.token } : {}),
          limit: String(s.limit),
          period: s.period,
        })),
      };

      const client = new AltanaClient();
      // Use the already-obtained wallet+signer to avoid a second WebAuthn prompt
      const { session, sessionKey } = await client.grantWithWallet(wallet, signer, {
        permissions: sdkPermissions,
        expirySeconds,
        chainId: walletChainId,
      });

      const res = await fetch("/api/mandates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet.address,
          agentId,
          category,
          capUsd,
          expirySeconds,
          sessionPublicKey: session.publicKey,
          sessionSigner: sessionKey,
          permissions: serializablePermissions,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "failed to save mandate — session was granted onchain, revoke via Altana if needed");
      }
      const data = await res.json();
      if (data.runToken) setRunToken(data.runToken as string);
      setWalletAddress(wallet.address);
      setMandateId(data.id);
      setPhase("done");
      setPendingWallet(null);
      setFundingAddress(null);
      persistHire(wallet.address, data.id);
      fetchTools(agentId);
    } catch (e: any) {
      if (isInsufficientFundsError(e)) {
        setError(
          `On-chain session grant failed — the wallet has no gas. Fund ${wallet.address} with a little ${isTestnet ? "testnet " : ""}BNB and click “I've funded — retry”. Details: ${String(e?.message ?? e).slice(0, 300)}`,
        );
        setFundingAddress(wallet.address);
        setPhase("needsFunding");
        return;
      }
      setError(String(e?.message ?? e));
      setPhase("error");
    }
  }

  async function grantWithMode(requestedMode: Mode) {
    setMode(requestedMode);
    setPhase("prompting");
    setError(null);
    setFundingAddress(null);
    try {
      const client = new AltanaClient();
      const res =
        requestedMode === "create"
          ? await client.createWallet("Vigil")
          : await client.recoverWallet();
      const { wallet, signer, chainId: walletChainId } = res;

      // Check if wallet needs funding before attempting grant
      const shouldProceed = await checkBalanceAndProceed(wallet, signer, walletChainId);
      if (!shouldProceed) return;

      await doGrant(wallet, signer, walletChainId);
    } catch (e: any) {
      if (isUserCancelError(e)) {
        const isCreate = requestedMode === "create";
        setError(
          isCreate
            ? "Passkey creation was cancelled. Click “Create new wallet” to try again, or use an existing passkey if you already have one."
            : "Passkey was cancelled or no passkey was selected. Try again, or click “Create new wallet” if this is your first time on this device.",
        );
        setPhase("form");
        setMode(null);
        return;
      }
      if (isNoKeysRegisteredError(e)) {
        const addr = extractWalletFromNoKeysError(e);
        if (addr) {
          // This wallet exists as a passkey but has never been deployed on this chain — needs funding/deployment
          setFundingAddress(addr);
          setPendingWallet(null);
          setError(
            `Picked passkey resolves to wallet ${addr}, but that wallet has no keys registered on ${isTestnet ? "testnet" : "mainnet"} yet. Fund ${addr} with a little ${isTestnet ? "testnet " : ""}BNB so the first on-chain registration can succeed, then click “Use existing passkey” again. If this is a fresh device, click “Create new wallet” instead.`,
          );
          setPhase("needsFunding");
          setMode(null);
          return;
        }
        setError(
          String(e?.message ?? e) +
            " — This usually means no Vigil wallet exists for this passkey on this domain. Click “Create new wallet” instead.",
        );
      } else if (isInsufficientFundsError(e)) {
        const addr = extractWalletFromNoKeysError(e) ?? "";
        setError(
          `Wallet ${addr ? addr + " " : ""}has no gas for the on-chain registration (Reason: 0x). Fund it with a little ${isTestnet ? "testnet " : ""}BNB and retry. Faucet: ${faucetUrl}`,
        );
        if (addr) setFundingAddress(addr);
        setPhase("needsFunding");
        setMode(null);
        return;
      } else {
        setError(String(e?.message ?? e));
      }
      setPhase("error");
      setMode(null);
    }
  }

  async function retryAfterFunding() {
    if (!pendingWallet) {
      setError("No wallet to retry. Please click “Use existing passkey” again after funding.");
      setPhase("form");
      return;
    }
    // Re-check balance, then retry grant
    try {
      setPhase("checking");
      const client = getPublicClient(pendingWallet.chainId);
      const bal = await client.getBalance({ address: pendingWallet.wallet.address as `0x${string}` });
      if (bal === 0n) {
        setError(`Wallet ${pendingWallet.wallet.address} still has 0 balance. Fund it first and try again.`);
        setPhase("needsFunding");
        return;
      }
      await doGrant(pendingWallet.wallet, pendingWallet.signer, pendingWallet.chainId);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setPhase("error");
    }
  }

  async function executeTool(dryRun: boolean) {
    if (!mandateId || !selectedTool) return;
    setExecPhase("running");
    setExecResult(null);
    try {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(argsJson);
      } catch {
        throw new Error("args is not valid JSON");
      }
      const res = await fetch("/api/hire", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(runToken ? { Authorization: `Bearer ${runToken}` } : {}),
        },
        body: JSON.stringify({ agentId, mandateId, tool: selectedTool, args, dryRun }),
      });
      const data = await res.json();
      setExecResult(data);
      setExecPhase(data.ok ? "done" : "error");
    } catch (e: any) {
      setExecResult({ ok: false, error: String(e?.message ?? e) });
      setExecPhase("error");
    }
  }

  if (phase === "done" && walletAddress && mandateId) {
    return (
      <div className="mt-6 space-y-6">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <div className="text-2xl">✓</div>
          <h2 className="mt-2 text-lg font-semibold text-emerald-900">{agentName} is hired</h2>
          <p className="mt-1 text-sm text-emerald-800">
            A capped, revocable session is live on your wallet. You can revoke it any time, and every action it takes is validated and receipted.
          </p>
          <div className="mt-3 font-mono text-xs text-emerald-700">
            {walletAddress.slice(0, 10)}…{walletAddress.slice(-8)} · cap ${capUsd}/day · {new Date(expirySeconds * 1000).toLocaleDateString()}
          </div>
          <div className="mt-4 flex justify-center gap-3">
            <button
              onClick={() => router.push(`/watch/${walletAddress}`)}
              className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm text-white hover:bg-emerald-600"
            >
              View receipts
            </button>
            <a href={`/agent/${encodeURIComponent(agentId)}`} className="rounded-lg border border-emerald-300 px-5 py-2.5 text-sm text-emerald-800 hover:bg-emerald-100">
              Back to agent
            </a>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <h3 className="text-sm font-semibold">Try a tool</h3>
          <p className="mt-1 text-xs text-zinc-500">Call the agent&apos;s MCP tool, validate its calldata, and execute under your session. Read tools return data; write tools go through the full validation + session execution path.</p>
          {tools.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">Loading tools…</p>
          ) : (
            <>
              <label className="mt-4 block">
                <span className="text-xs text-zinc-500">Tool</span>
                <select
                  value={selectedTool}
                  onChange={(e) => {
                    setSelectedTool(e.target.value);
                    const t = tools.find((x) => x.name === e.target.value);
                    if (t?.inputSchema?.properties) {
                      const sample: Record<string, any> = {};
                      for (const k of t.inputSchema.required ?? Object.keys(t.inputSchema.properties)) {
                        if (k === "userAddress" || k === "wallet") sample[k] = walletAddress;
                        else if (k === "chainName") sample[k] = "bsc";
                        else if (k === "pool") sample[k] = "CORE";
                        else if (k === "tokenSymbols") sample[k] = ["USDT"];
                        else sample[k] = "";
                      }
                      setArgsJson(JSON.stringify(sample, null, 2));
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                >
                  {tools.map((t) => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))}
                </select>
                {tools.find((t) => t.name === selectedTool)?.description && (
                  <span className="mt-1 block text-xs text-zinc-400">{tools.find((t) => t.name === selectedTool)?.description}</span>
                )}
              </label>
              <label className="mt-4 block">
                <span className="text-xs text-zinc-500">Args (JSON)</span>
                <textarea
                  value={argsJson}
                  onChange={(e) => setArgsJson(e.target.value)}
                  rows={5}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs"
                  placeholder='{"userAddress":"0x...","chainName":"bsc"}'
                />
              </label>
              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => executeTool(true)}
                  disabled={execPhase === "running"}
                  className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
                >
                  {execPhase === "running" ? "Running…" : "Simulate (dry run)"}
                </button>
                <button
                  onClick={() => executeTool(false)}
                  disabled={execPhase === "running"}
                  className="flex-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
                >
                  Execute
                </button>
              </div>
              {execResult && (
                <pre className={`mt-4 rounded-lg p-3 text-xs overflow-auto max-h-64 ${execResult.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-900" : "bg-red-50 border border-red-200 text-red-800"}`}>
                  {JSON.stringify(execResult, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>

        <AutonomyPanel agentId={agentId} mandateId={mandateId} runToken={runToken} capUsd={capUsd} />
      </div>
    );
  }

  const isBusy = phase === "prompting" || phase === "checking" || phase === "granting";

  if (phase === "needsFunding" && fundingAddress) {
    return (
      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h3 className="text-sm font-semibold text-amber-900">Wallet needs gas to register on-chain</h3>
        <p className="mt-2 text-xs text-amber-800">
          Your wallet <span className="font-mono font-medium">{fundingAddress.slice(0, 10)}…{fundingAddress.slice(-8)}</span> has 0 {isTestnet ? "testnet " : ""}BNB. The first on-chain registration (passkey → Keystore + session) needs a little gas. This is free on testnet.
        </p>
        <div className="mt-4 rounded-lg border border-amber-200 bg-white p-3 flex items-center gap-2">
          <span className="flex-1 font-mono text-xs truncate">{fundingAddress}</span>
          <button
            onClick={() => navigator.clipboard.writeText(fundingAddress)}
            className="shrink-0 rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50"
          >
            Copy
          </button>
          <a href={explorerUrl(fundingAddress)} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-sky-600 hover:underline">
            Explorer
          </a>
        </div>
        <div className="mt-4 flex flex-col sm:flex-row gap-3">
          <a
            href={faucetUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-lg border border-amber-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-amber-900 hover:bg-amber-100"
          >
            Open {isTestnet ? "testnet " : ""}faucet
          </a>
          <button
            onClick={retryAfterFunding}
            className="flex-1 rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-800"
          >
            I&apos;ve funded — retry
          </button>
        </div>
        <p className="mt-3 text-[11px] text-amber-700">
          {isTestnet ? "Fund with 0.05 testnet BNB, wait ~10s for confirmation, then retry. No real funds needed." : "Fund with ~0.01 BNB mainnet, or set NEXT_PUBLIC_ALTANA_CHAIN=testnet and use the free faucet for demo."}
        </p>
        <button
          onClick={() => {
            setPhase("form");
            setError(null);
            setFundingAddress(null);
            setMode(null);
          }}
          className="mt-3 text-xs text-amber-800 underline hover:text-amber-900"
        >
          ← Back to passkey choices
        </button>
        {error && <p className="mt-3 rounded bg-white border border-amber-200 px-3 py-2 text-xs text-amber-800">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Set your limits</h2>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs text-zinc-500">Daily spend cap (USD)</span>
          <input
            type="number"
            min={1}
            value={capUsd}
            onChange={(e) => setCapUsd(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Expires in</span>
          <select
            value={expirySeconds}
            onChange={(e) => setExpirySeconds(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
          >
            <option value={Math.floor(Date.now() / 1000) + 7 * 24 * 3600}>7 days</option>
            <option value={Math.floor(Date.now() / 1000) + 30 * 24 * 3600}>30 days</option>
            <option value={Math.floor(Date.now() / 1000) + 90 * 24 * 3600}>90 days</option>
          </select>
        </label>
      </div>
      {isTestnet && (
        <p className="mt-3 text-xs text-sky-600">
          Demo mode: {chainId === 97 ? "BSC Testnet" : "BSC Mainnet"} — {isTestnet ? "testnet BNB is free from the faucet, no real funds needed." : "mainnet needs real BNB."}
        </p>
      )}

      <div className="mt-6">
        <h3 className="text-sm font-medium text-zinc-800">Choose a passkey action</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Use an existing passkey if you&apos;ve used Vigil on this device before. First time here? Create a new wallet — it takes one biometric prompt.
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => grantWithMode("recover")}
            disabled={isBusy}
            className="rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 flex flex-col items-center gap-1"
          >
            <span>{phase === "prompting" && mode === "recover" ? "Check your device…" : phase === "checking" ? "Checking balance…" : "Use existing passkey"}</span>
            <span className="text-[11px] font-normal text-zinc-300">Face ID / Touch ID picker</span>
          </button>
          <button
            onClick={() => grantWithMode("create")}
            disabled={isBusy}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60 flex flex-col items-center gap-1"
          >
            <span>{phase === "prompting" && mode === "create" ? "Check your device…" : phase === "checking" ? "Checking balance…" : "Create new wallet"}</span>
            <span className="text-[11px] font-normal text-zinc-500">One-time setup</span>
          </button>
        </div>
      </div>

      <p className="mt-4 text-xs text-zinc-400">
        No seed phrase. The session key is scoped to exactly what&apos;s shown above and registered in Altana&apos;s public Keystore. You can revoke it any time.
      </p>

      {error && (
        <div className="mt-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-3">
          <p className="text-xs font-medium text-amber-900">Passkey didn&apos;t complete</p>
          <p className="mt-1 text-xs text-amber-800 whitespace-pre-wrap break-words">{error}</p>
          <button
            onClick={() => {
              setError(null);
              setPhase("form");
              setMode(null);
            }}
            className="mt-2 text-xs font-medium text-amber-900 underline hover:text-amber-700"
          >
            Dismiss
          </button>
        </div>
      )}
      {phase === "error" && !error && (
        <p className="mt-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">Something went wrong. Please try again.</p>
      )}
    </div>
  );
}

/**
 * Post-hire autonomy. The user's own runner (cron, CLI loop, LLM operator)
 * calls Vigil with the run token to act unattended — inside the same mandate:
 * calldata validation, the simulation gate, the onchain spend caps, and
 * one-click revocation all still apply to every call. The token is shown once
 * here and kept only as a hash server-side.
 */
function AutonomyPanel({
  agentId,
  mandateId,
  runToken,
  capUsd,
}: {
  agentId: string;
  mandateId: string;
  runToken: string | null;
  capUsd: number;
}) {
  const [origin, setOrigin] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    // Legacy mandates granted before run tokens existed have none; everything
    // else in this panel needs one, so default to revealed-less copy state.
  }, []);

  if (!runToken) return null;

  const curl = `curl -X POST ${origin}/api/hire \\
  -H "Authorization: Bearer ${runToken}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": "${agentId}",
    "mandateId": "${mandateId}",
    "tool": "<tool-name>",
    "args": { },
    "dryRun": true
  }'`;

  const cron = `# every hour, unattended — the caps below are enforced onchain either way
0 * * * * ${curl.replace(/\n/g, "\n      ")}`;

  const masked = `${runToken.slice(0, 8)}${"•".repeat(24)}${runToken.slice(-6)}`;

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1600);
    } catch {}
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-white p-6">
      <h3 className="text-sm font-semibold">Let it run by itself</h3>
      <p className="mt-1 text-xs text-zinc-500">
        Hand this token to your own runner — a cron job, a CLI loop, or an AI operator like Claude or
        GPT. It can then call this hired agent on your behalf, unattended. Authority does not get
        wider: every call passes calldata validation, a live simulation, and the{" "}
        <span className="font-medium text-zinc-700">${capUsd}/day</span> cap enforced by your onchain
        session — and revoking the mandate kills it instantly.
      </p>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-zinc-400 shrink-0">Run token</span>
        <code className="flex-1 truncate font-mono text-xs text-zinc-800">{revealed ? runToken : masked}</code>
        <button onClick={() => setRevealed((v) => !v)} className="shrink-0 rounded border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-100">
          {revealed ? "Hide" : "Reveal"}
        </button>
        <button onClick={() => copy("token", runToken)} className="shrink-0 rounded border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-100">
          {copied === "token" ? "Copied!" : "Copy"}
        </button>
      </div>

      <div className="mt-4 relative">
        <pre className="overflow-auto rounded-lg bg-zinc-900 p-4 pr-20 text-[11px] leading-relaxed text-zinc-100">{curl}</pre>
        <button
          onClick={() => copy("curl", curl)}
          className="absolute right-2 top-2 rounded border border-zinc-600 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
        >
          {copied === "curl" ? "Copied!" : "Copy"}
        </button>
      </div>

      <p className="mt-3 text-xs text-zinc-500">
        Start with <code className="font-mono text-[11px]">dryRun: true</code> — it validates and simulates without
        submitting. Set it to <code className="font-mono text-[11px]">false</code> when you trust the tool.
        The tool list + JSON schemas for your runner are machine-readable at{" "}
        <a className="text-sky-600 hover:underline break-all" href={`/api/agent/${encodeURIComponent(agentId)}/tools`}>
          /api/agent/{agentId}/tools
        </a>.
      </p>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-sky-700">Show hourly-cron example</summary>
        <pre className="mt-2 overflow-auto rounded-lg bg-zinc-50 p-3 text-[10px] leading-relaxed text-zinc-700">{cron}</pre>
      </details>

      <p className="mt-3 text-[11px] text-zinc-400">
        Treat the token like a password: Vigil stores only its hash and shows it once. If you lose it,
        revoke the mandate and hire again — it takes one biometric prompt.
      </p>
    </div>
  );
}
