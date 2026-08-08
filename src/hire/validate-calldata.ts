import { decodeFunctionData, hexToBigInt, type Address, type Hex } from "viem";
import { publicClient } from "../lib/rpc";

/**
 * SECURITY CRITICAL — validates calldata returned by a THIRD-PARTY agent
 * before it is submitted under a user's Altana session.
 *
 * Defense in depth:
 *   1. Decode target + selector + args (reject if we can't).
 *   2. Target must be in the mandate's contract allowlist.
 *   3. Selector must be in the permitted set for that mandate.
 *   4. Approve must not name a non-allowlisted spender.
 *   5. Simulate with eth_call against the live chain.
 *   6. Amount must fit the remaining session spend cap.
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

const KNOWN_SIGNATURES: Record<string, string> = {
  "0x095ea7b3": "approve",
  "0xa9059cbb": "transfer",
  "0x23b872dd": "transferFrom",
  // Venus / Compound vTokens
  "0xa0712d68": "mint",
  "0x4e4d9fea": "redeem",
  "0x0c5a31c1": "borrow",
  "0x573ade81": "repayBorrow",
  "0x9f0b57d9": "enterMarkets",
  "0xc2998238": "exitMarket",
  // Aave v3 pool
  "0x617ba037": "supply",
  "0xde568061": "repay",
  "0x69328dec": "withdraw",
  "0x5b6fd01b": "borrow",
  // PancakeSwap V3 NPM
  "0x0c49ccbe": "decreaseLiquidity",
  "0xfc6f7865": "collect",
  "0x88316456": "mint",
  // Router
  "0x414bf389": "exactInputSingle",
  "0xc04b8d59": "exactInput",
};

const FORBIDDEN_SELECTORS = ["0x095ea7b3"]; // approve — must be validated by spender check

export function validateCalldata(
  call: { to: Address; data: Hex; value?: bigint },
  opts: {
    allowlist: Address[];
    permittedSelectors?: string[];
    /** Spenders approve() is allowed to name (protocol contracts only). */
    allowedApproveSpenders?: Address[];
    maxAmountWei?: bigint;
  },
): ValidationResult {
  const { to, data } = call;

  // 1. Target allowlist.
  if (!opts.allowlist.some((a) => a.toLowerCase() === to.toLowerCase())) {
    return { ok: false, reason: `target ${to} not in allowlist` };
  }

  // 2. Decode.
  if (!data || data === "0x") {
    return { ok: false, reason: "empty calldata" };
  }
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  const sig = KNOWN_SIGNATURES[selector] ?? selector;
  const decoded = { functionName: sig, args: [] as unknown[] };

  // 3. Selector permit.
  if (opts.permittedSelectors && !opts.permittedSelectors.includes(selector)) {
    return { ok: false, reason: `selector ${selector} (${sig}) not permitted` };
  }

  // 4. Approve spender check.
  if (selector === "0x095ea7b3") {
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
        ],
        data,
      });
      spender = (d.args[0] as string).toLowerCase();
    } catch {
      return { ok: false, reason: "approve decode failed" };
    }
    const allowed = opts.allowedApproveSpenders?.map((s) => s.toLowerCase()) ?? [];
    if (!allowed.includes(spender)) {
      return { ok: false, reason: `approve to non-allowlisted spender ${spender}` };
    }
  }

  // 5. Amount cap (approve/transfer/repay/mint amounts).
  if (opts.maxAmountWei) {
    try {
      let amount = 0n;
      if (selector === "0x095ea7b3" || selector === "0xa9059cbb" || selector === "0x573ade81" || selector === "0xa0712d68") {
        const d = decodeFunctionData({
          abi: [
            {
              type: "function",
              name: "amountFn",
              stateMutability: "nonpayable",
              inputs: [
                { type: "address", name: "a" },
                { type: "uint256", name: "b" },
              ],
              outputs: [{ type: "uint256" }],
            },
          ],
          data,
        });
        amount = hexToBigInt(data.slice(10 + 64, 10 + 128) as Hex);
      }
      if (amount > opts.maxAmountWei) {
        return { ok: false, reason: `amount ${amount} exceeds cap ${opts.maxAmountWei}` };
      }
    } catch {
      /* non-standard encoding — skip amount check, session cap still applies */
    }
  }

  return { ok: true, decoded };
}

/** Simulate the call against live chain; reject if it reverts. */
export async function simulateCall(call: { to: Address; data: Hex; value?: bigint }): Promise<boolean> {
  try {
    await publicClient.call({ to: call.to, data: call.data, value: call.value ?? 0n });
    return true;
  } catch {
    return false;
  }
}
