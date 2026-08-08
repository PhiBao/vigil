import type { Address } from "viem";
import type { SessionPermissions } from "@altananetwork/sdk";
import { ADDRESSES } from "../config";
import { toBaseUnits } from "../lib/money";
import type { Category } from "../registry/model";

/**
 * Concrete onchain session permissions per CATEGORY. A user hires a
 * third-party agent whose tool calldata targets specific protocol contracts;
 * the mandate allowlist is built from those contracts. Invariants:
 *   1. `calls` and `spend` are always set (omitting calls = unrestricted).
 *   2. USDT/USDC use 18 decimals on BNB Chain.
 */

const USDT = ADDRESSES.usdt;

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

/** Contract allowlist for a category (what third-party calldata may target). */
export function allowlistForCategory(category: Category): Address[] {
  switch (category) {
    case "health_factor":
      return [
        ...Object.values(VENUS_CORE_MARKETS),
        AAVE_V3_POOL,
        ADDRESSES.usdt,
        ADDRESSES.usdc,
        ADDRESSES.usdc,
      ];
    case "yield":
      return [
        ...Object.values(VENUS_CORE_MARKETS),
        AAVE_V3_POOL,
        LISTA_STAKE_MANAGER,
        ADDRESSES.usdt,
        ADDRESSES.usdc,
      ];
    case "rebalancing":
      return [
        ADDRESSES.pancakeV3NPM,
        ADDRESSES.pancakeV3SwapRouter,
        ADDRESSES.usdt,
        ADDRESSES.usdc,
        ADDRESSES.wbnb,
      ];
    case "grid":
      return [ADDRESSES.pancakeV3SwapRouter, ADDRESSES.usdt, ADDRESSES.wbnb];
    case "monitoring":
      return []; // read-only agents need no write authority
  }
}

/** Build the actual SessionPermissions for a category. */
export function buildPermissions(category: Category, opts: MandateOptions): SessionPermissions {
  const allow = allowlistForCategory(category);
  if (allow.length === 0) {
    // Monitoring agents are read-only: still enforce an empty call set so the
    // session cannot move funds at all.
    return { calls: [{ to: "0x000000000000000000000000000000000000dEaD" }], spend: [] };
  }
  return {
    calls: allow.map((to) => ({ to })),
    spend: [
      { token: USDT, limit: toBaseUnits(opts.capUsd), period: "day" },
      { token: ADDRESSES.usdc, limit: toBaseUnits(opts.capUsd), period: "day" },
    ],
  };
}

/** Human-readable may/may-not from a category (rendered at consent time). */
export function renderMandate(category: Category, capUsd: number) {
  const may: string[] = [];
  const mayNot: string[] = [];
  switch (category) {
    case "health_factor":
      may.push(
        "Call the lending protocols this agent manages (Venus / Aave)",
        `Move up to ${capUsd} USDT/USDC within your positions (repay, supply, collateral)`,
        "Read your position state at any time",
      );
      mayNot.push("Move funds to any address outside these protocols", "Act after expiry", "Act after you revoke");
      break;
    case "yield":
      may.push(
        "Call the yield protocols this agent manages (Venus / Aave / Lista)",
        `Move up to ${capUsd} USDT/USDC between your yield positions`,
      );
      mayNot.push("Send funds to any address", "Act after expiry", "Act after you revoke");
      break;
    case "rebalancing":
      may.push(
        "Call the PancakeSwap V3 position manager",
        `Move up to ${capUsd} USDT/USDC/WBNB within your liquidity positions`,
      );
      mayNot.push("Move funds to any address outside PancakeSwap", "Act after expiry", "Act after you revoke");
      break;
    case "grid":
      may.push(`Trade USDT/WBNB up to ${capUsd} USDT per day`);
      mayNot.push("Trade any pair except USDT/WBNB", "Exceed the daily cap", "Act after expiry");
      break;
    case "monitoring":
      may.push("Read your positions and send alerts");
      mayNot.push("Move any funds at all");
      break;
  }
  return { may, mayNot };
}
