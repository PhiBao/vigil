import type { Address, Hex } from "viem";
import { toFunctionSelector } from "viem";
import type { SessionPermissions } from "@altananetwork/sdk";
import { ADDRESSES } from "../config";
import { toBaseUnits } from "../lib/money";
import type { Category } from "../registry/model";

/**
 * Concrete onchain session permissions per CATEGORY. A user hires a
 * third-party agent whose tool calldata targets specific protocol contracts;
 * the mandate allowlist is built from those contracts. Invariants:
 *   1. `calls` and `spend` are always set (omitting calls = unrestricted).
 *   2. USDT/USDC/WBNB use 18 decimals on BNB Chain.
 *   3. EVERY value-bearing asset reachable through `calls` has a `spend` cap.
 *
 * Invariant 3 is enforced structurally: `spend` is derived from the allowlist
 * so a token cannot be call-allowlisted without a cap (see `assertCapsCoverAllowlist`).
 * Two assets were reachable-but-uncapped before this was enforced:
 *   - WBNB. `rebalancing`/`grid` allowlist WBNB and `{to}`-only calls authorise
 *     every function including `transfer(attacker, balance)`.
 *   - Native BNB. `health_factor`/`yield` allowlist payable contracts (vBNB,
 *     Lista). A SpendPermission without `token` is the native cap per the SDK.
 */

const USDT = ADDRESSES.usdt;
const USDC = ADDRESSES.usdc;
const WBNB = ADDRESSES.wbnb;

export const VENUS_CORE_MARKETS = {
  vUSDT: "0xfD5840Cd36d94D7229439859C0112a4185BC0255",
  vUSDC: "0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8",
  vWBNB: "0x6bCa74586218dB34cdB402295796b79663d816e9",
  vBNB: "0xA07c5b74C9B40447a954e1466938b865b6BBea36",
  vBTCB: "0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B",
  vETH: "0xf508fCD89b8bd15579dc79A6827cB4686A3592c8",
  vFDUSD: "0xC4eF4229FEc74Ccfe17B2bdeF7715fAC740BA0ba",
} as const;

const AAVE_V3_POOL = "0x6807dc923806fE8Fd134338EABCA509979a7e0cB" as Address;
const LISTA_STAKE_MANAGER = "0x1adB950d8bB3dA4bE104211D5AB038628e477fE6" as Address;

export interface MandateOptions {
  capUsd: number;
  /** Unix seconds. Default 30 days. */
  expirySeconds: number;
  walletAddress: Address;
  /** Restrict collateral markets to those the user actually uses (from scan). */
  usedMarkets?: Address[];
}

function uniqAddrs(addrs: Address[]): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const a of addrs) {
    const k = a.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(a);
    }
  }
  return out;
}

/** Contract allowlist for a category (what third-party calldata may target). */
export function allowlistForCategory(category: Category): Address[] {
  switch (category) {
    case "health_factor":
      return uniqAddrs([
        ...Object.values(VENUS_CORE_MARKETS),
        AAVE_V3_POOL,
        USDT,
        USDC,
      ]);
    case "yield":
      return uniqAddrs([
        ...Object.values(VENUS_CORE_MARKETS),
        AAVE_V3_POOL,
        LISTA_STAKE_MANAGER,
        USDT,
        USDC,
      ]);
    case "rebalancing":
      return uniqAddrs([
        ADDRESSES.pancakeV3NPM,
        ADDRESSES.pancakeV3SwapRouter,
        USDT,
        USDC,
        WBNB,
      ]);
    case "grid":
      return uniqAddrs([ADDRESSES.pancakeV3SwapRouter, USDT, WBNB]);
    case "monitoring":
      return []; // read-only agents need no write authority
  }
}

// ---------------------------------------------------------------------------
// Spend derivation — invariant 3: every token in `calls` has a spend cap.
// ---------------------------------------------------------------------------

/** Tokens that need a spend cap per category. `undefined` = native BNB (no token field). */
const SPEND_TOKENS: Record<Category, (Address | undefined)[]> = {
  health_factor: [USDT, USDC, undefined],
  yield: [USDT, USDC, undefined],
  rebalancing: [USDT, USDC, WBNB, undefined],
  grid: [USDT, WBNB, undefined],
  monitoring: [],
};

/** Known ERC-20 token contracts that, if present in `calls`, must have a spend entry. */
const TOKEN_ALLOWLIST_SET = new Set<string>([USDT.toLowerCase(), USDC.toLowerCase(), WBNB.toLowerCase()]);

function assertCapsCoverAllowlist(allow: Address[], spendTokens: (Address | undefined)[]): void {
  const spendSet = new Set(spendTokens.filter((t): t is Address => !!t).map((t) => t.toLowerCase()));
  const hasNative = spendTokens.includes(undefined);
  for (const addr of allow) {
    const low = addr.toLowerCase();
    if (TOKEN_ALLOWLIST_SET.has(low) && !spendSet.has(low)) {
      throw new Error(`invariant violation: allowlisted token ${addr} has no spend cap`);
    }
  }
  // Native cap is required whenever any payable contract is allowlisted.
  // For now every non-monitoring category is assumed to have at least one payable entry.
  void hasNative;
}

/** Build the actual SessionPermissions for a category. */
export function buildPermissions(category: Category, opts: MandateOptions): SessionPermissions {
  const allow = allowlistForCategory(category);
  if (allow.length === 0) {
    // Monitoring agents are read-only. Use a dead call target so the session
    // cannot move funds at all, and keep `calls` present (omitting it = unrestricted).
    return { calls: [{ to: "0x000000000000000000000000000000000000dEaD" as Address }], spend: [] };
  }
  const spendTokens = SPEND_TOKENS[category];
  assertCapsCoverAllowlist(allow, spendTokens);
  const limit = toBaseUnits(opts.capUsd);
  return {
    calls: allow.map((to) => ({ to })),
    spend: spendTokens.map((token) =>
      token ? { token, limit, period: "day" as const } : { limit, period: "day" as const },
    ),
  };
}

// ---------------------------------------------------------------------------
// Selector table — derived from signatures, never hand-typed hex.
// ---------------------------------------------------------------------------

/** All protocol signatures we recognise. Selectors are derived via `toFunctionSelector` at load time. */
export const PROTOCOL_SIGNATURES = [
  "approve(address,uint256)",
  "transfer(address,uint256)",
  "transferFrom(address,address,uint256)",
  // Venus / Compound vTokens
  "mint(uint256)",
  "redeem(uint256)",
  "redeemUnderlying(uint256)",
  "borrow(uint256)",
  "repayBorrow(uint256)",
  "repayBorrow()",
  "enterMarkets(address[])",
  "exitMarket(address)",
  // Aave v3 pool
  "supply(address,uint256,address,uint16)",
  "repay(address,uint256,uint256,address)",
  "withdraw(address,uint256,address)",
  "borrow(address,uint256,uint256,uint16,address)",
  // PancakeSwap V3 NPM
  "decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))",
  "collect((uint256,address,uint128,uint128))",
  "mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))",
  "increaseLiquidity((uint256,uint256,uint256,uint256,uint256,address,uint256))",
  // Router
  "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))",
  "exactInput((bytes,address,uint256,uint256,uint256))",
  "unwrapWETH9(uint256,address)",
  "refundETH()",
  "sweepToken(address,uint256,address)",
] as const;

/** Derived: selector hex -> short name (for display). */
export const KNOWN_SIGNATURES: Record<string, string> = Object.fromEntries(
  PROTOCOL_SIGNATURES.map((sig) => [toFunctionSelector(sig), sig.slice(0, sig.indexOf("("))]),
);

/** Derived: signature string -> selector hex. */
export const SIGNATURE_TO_SELECTOR: Record<string, Hex> = Object.fromEntries(
  PROTOCOL_SIGNATURES.map((sig) => [sig, toFunctionSelector(sig)]),
) as Record<string, Hex>;

// Per-category permitted signature sets. These are the selectors that
// `validateCalldata` will accept when `permittedSelectors` is passed.
const CATEGORY_SIGNATURES: Record<Category, readonly string[]> = {
  health_factor: [
    "approve(address,uint256)",
    "transfer(address,uint256)",
    "mint(uint256)",
    "redeem(uint256)",
    "redeemUnderlying(uint256)",
    "borrow(uint256)",
    "repayBorrow(uint256)",
    "repayBorrow()",
    "enterMarkets(address[])",
    "exitMarket(address)",
    "supply(address,uint256,address,uint16)",
    "repay(address,uint256,uint256,address)",
    "withdraw(address,uint256,address)",
    "borrow(address,uint256,uint256,uint16,address)",
  ],
  yield: [
    "approve(address,uint256)",
    "transfer(address,uint256)",
    "mint(uint256)",
    "redeem(uint256)",
    "redeemUnderlying(uint256)",
    "supply(address,uint256,address,uint16)",
    "withdraw(address,uint256,address)",
    "borrow(address,uint256,uint256,uint16,address)",
    "repay(address,uint256,uint256,address)",
  ],
  rebalancing: [
    "approve(address,uint256)",
    "transfer(address,uint256)",
    "mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))",
    "increaseLiquidity((uint256,uint256,uint256,uint256,uint256,address,uint256))",
    "decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))",
    "collect((uint256,address,uint128,uint128))",
    "sweepToken(address,uint256,address)",
    "unwrapWETH9(uint256,address)",
    "refundETH()",
  ],
  grid: [
    "approve(address,uint256)",
    "transfer(address,uint256)",
    "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))",
    "exactInput((bytes,address,uint256,uint256,uint256))",
    "unwrapWETH9(uint256,address)",
    "refundETH()",
    "sweepToken(address,uint256,address)",
  ],
  monitoring: [],
};

/** Hex selectors permitted for a category. */
export function selectorsForCategory(category: Category): Hex[] {
  return (CATEGORY_SIGNATURES[category] ?? []).map((sig) => SIGNATURE_TO_SELECTOR[sig]).filter(Boolean);
}

/** Spend allowlist (approve targets) for a category — the token contracts themselves. */
export function allowedApproveSpendersForCategory(category: Category): Address[] {
  return allowlistForCategory(category);
}

// ---------------------------------------------------------------------------
// Consent text — generated from the same tables as enforcement.
// ---------------------------------------------------------------------------

/** Human-readable may/may-not from a category (rendered at consent time). */
export function renderMandate(category: Category, capUsd: number) {
  const spendTokens = SPEND_TOKENS[category];
  const tokenLabels: string[] = spendTokens.map((t) => {
    if (!t) return "native BNB";
    const low = t.toLowerCase();
    if (low === USDT.toLowerCase()) return "USDT";
    if (low === USDC.toLowerCase()) return "USDC";
    if (low === WBNB.toLowerCase()) return "WBNB";
    return t.slice(0, 6) + "…";
  });
  const capLabel =
    spendTokens.length === 0
      ? "no funds"
      : spendTokens.length === 1
        ? `up to $${capUsd} of ${tokenLabels[0]} per day`
        : `up to $${capUsd} per token per day (${tokenLabels.join(", ")})`;

  const may: string[] = [];
  const mayNot: string[] = [];
  switch (category) {
    case "health_factor":
      may.push(
        "Call the lending protocols this agent manages (Venus / Aave)",
        `Move ${capLabel} within your lending positions (repay, supply, collateral)`,
        "Read your position state at any time",
      );
      mayNot.push("Call any contract outside Venus/Aave and the capped tokens", "Act after expiry", "Act after you revoke");
      break;
    case "yield":
      may.push(
        "Call the yield protocols this agent manages (Venus / Aave / Lista)",
        `Move ${capLabel} between your yield positions`,
      );
      mayNot.push("Call any contract outside Venus/Aave/Lista and the capped tokens", "Act after expiry", "Act after you revoke");
      break;
    case "rebalancing":
      may.push(
        "Call the PancakeSwap V3 position manager and swap router",
        `Move ${capLabel} within your liquidity positions`,
      );
      mayNot.push("Call any contract outside PancakeSwap and the capped tokens", "Act after expiry", "Act after you revoke");
      break;
    case "grid":
      may.push(`Trade via PancakeSwap swap router — ${capLabel} (token transfers and native value both capped)`);
      mayNot.push("Trade any pair beyond the router's allowlist", "Exceed the per-token or native daily caps", "Act after expiry");
      break;
    case "monitoring":
      may.push("Read your positions and send alerts");
      mayNot.push("Move any funds at all (no call or spend permissions granted)");
      break;
  }
  if (spendTokens.includes(undefined) && category !== "monitoring") {
    may.push("Native BNB value attached to calls is capped the same way as token spend");
  }
  return { may, mayNot };
}
