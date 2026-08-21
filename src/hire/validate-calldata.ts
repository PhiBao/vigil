import { decodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { publicClient } from "../lib/rpc";
import { KNOWN_SIGNATURES, SIGNATURE_TO_SELECTOR, PROTOCOL_SIGNATURES } from "../mandate/permissions";

/**
 * SECURITY CRITICAL — validates calldata returned by a THIRD-PARTY agent
 * before it is submitted under a user's Altana session.
 *
 * Defense in depth:
 *   1. Target must be in the mandate's contract allowlist.
 *   2. Decode target + selector + args (reject if we can't).
 *   3. Selector must be in the permitted set for that mandate.
 *   4. Approve must not name a non-allowlisted spender.
 *   5. Simulate with eth_call against the live chain (as the wallet).
 *   6. Amount and native value must fit the session caps.
 * The onchain Altana session is the final backstop even if this validator is
 * wrong — loss is bounded by the session permissions, never by our code.
 */

export interface ValidatedCall {
  to: Address;
  data: Hex;
  value?: bigint;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  decoded?: { functionName: string; args: unknown[] };
}

// ---------------------------------------------------------------------------
// Amount-bearing selectors — decoded via proper ABI, not hex slices.
// ---------------------------------------------------------------------------

/** Selector -> ABI + amount arg index. Only selectors in this map are amount-checked. */
type AmountSpec = { abi: readonly unknown[]; amountIndex: number };

function abiFor(sig: string): readonly unknown[] {
  // parseAbi expects array of human-readable fragments.
  return parseAbi([`function ${sig}`] as unknown as string[]) as unknown as readonly unknown[];
}

const AMOUNT_SPECS: Record<string, AmountSpec> = (() => {
  const m: Record<string, AmountSpec> = {};
  const defs: [string, number][] = [
    ["approve(address,uint256)", 1],
    ["transfer(address,uint256)", 1],
    ["transferFrom(address,address,uint256)", 2],
    ["mint(uint256)", 0],
    ["redeem(uint256)", 0],
    ["redeemUnderlying(uint256)", 0],
    ["borrow(uint256)", 0],
    ["repayBorrow(uint256)", 0],
    ["supply(address,uint256,address,uint16)", 1],
    ["repay(address,uint256,uint256,address)", 1],
    ["withdraw(address,uint256,address)", 1],
    ["borrow(address,uint256,uint256,uint16,address)", 1],
  ];
  for (const [sig, idx] of defs) {
    const sel = SIGNATURE_TO_SELECTOR[sig];
    if (sel) m[sel.toLowerCase()] = { abi: abiFor(sig), amountIndex: idx };
  }
  return m;
})();

// Selector -> ABI for generic arg decoding (to populate `decoded.args`).
const SELECTOR_ABI: Record<string, readonly unknown[]> = (() => {
  const m: Record<string, readonly unknown[]> = {};
  for (const sig of PROTOCOL_SIGNATURES) {
    const sel = SIGNATURE_TO_SELECTOR[sig];
    if (sel) m[sel.toLowerCase()] = abiFor(sig);
  }
  return m;
})();

const APPROVE_SELECTOR = SIGNATURE_TO_SELECTOR["approve(address,uint256)"]?.toLowerCase();

export function validateCalldata(
  call: { to: Address; data: Hex; value?: bigint },
  opts: {
    allowlist: Address[];
    permittedSelectors?: string[];
    /** Spenders approve() is allowed to name (protocol contracts only). */
    allowedApproveSpenders?: Address[];
    maxAmountWei?: bigint;
    maxValueWei?: bigint;
  },
): ValidationResult {
  const { to, data, value } = call;

  // 1. Target allowlist.
  if (!opts.allowlist.some((a) => a.toLowerCase() === to.toLowerCase())) {
    return { ok: false, reason: `target ${to} not in allowlist` };
  }

  // 2. Native value cap — checked before any other decode so a payable
  //    call with excessive value cannot bypass the token-amount path.
  const maxValue = opts.maxValueWei ?? 0n;
  if (value !== undefined && value !== 0n && value > maxValue) {
    return { ok: false, reason: `native value ${value} exceeds cap ${maxValue}` };
  }

  // 3. Decode presence.
  if (!data || data === "0x") {
    return { ok: false, reason: "empty calldata" };
  }
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  const sigName = KNOWN_SIGNATURES[selector] ?? selector;
  const decoded: { functionName: string; args: unknown[] } = { functionName: sigName, args: [] };

  // Try to populate decoded.args from the known ABI for this selector.
  const abiForSelector = SELECTOR_ABI[selector];
  if (abiForSelector) {
    try {
      const d = decodeFunctionData({ abi: abiForSelector as any, data });
      decoded.args = [...(d.args as unknown[])];
      decoded.functionName = (d.functionName as string) ?? sigName;
    } catch {
      // Leave args empty; specific checks below will decide whether this is fatal.
    }
  }

  // 4. Selector permit.
  if (opts.permittedSelectors && !opts.permittedSelectors.includes(selector)) {
    return { ok: false, reason: `selector ${selector} (${sigName}) not permitted` };
  }

  // 5. Approve spender check.
  if (selector === APPROVE_SELECTOR) {
    let spender: string | undefined;
    try {
      const d = decodeFunctionData({
        abi: [
          {
            type: "function",
            name: "approve",
            stateMutability: "nonpayable",
            inputs: [
              { type: "address", name: "spender" },
              { type: "uint256", name: "amount" },
            ],
            outputs: [{ type: "bool" }],
          },
        ] as const,
        data,
      });
      spender = (d.args[0] as string).toLowerCase();
      // Populate decoded if not already filled above.
      if (decoded.args.length === 0) decoded.args = [...(d.args as unknown as unknown[])];
    } catch {
      return { ok: false, reason: "approve decode failed" };
    }
    const allowed = opts.allowedApproveSpenders?.map((s) => s.toLowerCase()) ?? [];
    if (!allowed.includes(spender)) {
      return { ok: false, reason: `approve to non-allowlisted spender ${spender}` };
    }
  }

  // 6. Amount cap — fail-closed. If the selector is amount-bearing and decoding
  //    fails, we return `ok: false` (not `ok: true`). The previous `catch {}` that
  //    silently skipped the check is what made Finding 1 a silent no-op.
  if (opts.maxAmountWei !== undefined) {
    const spec = AMOUNT_SPECS[selector];
    if (spec) {
      let amount: bigint;
      try {
        const d = decodeFunctionData({ abi: spec.abi as any, data });
        const raw = (d.args as unknown[])[spec.amountIndex];
        if (typeof raw !== "bigint") {
          return { ok: false, reason: `amount decode produced non-bigint for ${sigName}` };
        }
        amount = raw;
        // Ensure decoded is populated for the receipt even when the generic decode above missed.
        if (decoded.args.length === 0) decoded.args = [...(d.args as unknown as unknown[])];
      } catch {
        return { ok: false, reason: `amount decode failed for ${sigName}` };
      }
      if (amount > opts.maxAmountWei) {
        return { ok: false, reason: `amount ${amount} exceeds cap ${opts.maxAmountWei}` };
      }
    }
  }

  return { ok: true, decoded };
}

/** Simulate the call against live chain; reject if it reverts. */
export async function simulateCall(
  call: { to: Address; data: Hex; value?: bigint },
  from?: Address,
): Promise<boolean> {
  try {
    await publicClient.call({
      to: call.to,
      data: call.data,
      value: call.value ?? 0n,
      ...(from ? { account: from } : {}),
    } as any);
    return true;
  } catch {
    return false;
  }
}
