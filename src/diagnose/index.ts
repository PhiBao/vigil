import type { ScanResult } from "../scanner";
import { stableYieldSpread, bestStablePool } from "../scanner/yields";
import { logger } from "../lib/logger";

/**
 * Diagnosis engine: turns raw scan state into plain-language, dollar-quantified
 * findings. Rules are conservative — the product's credibility depends on not
 * inventing urgency. Every threshold is explicit here.
 */

export type Severity = "critical" | "warning" | "info";
export type FindingCategory = "health_factor" | "lp_range" | "idle_yield" | "yield" | "rebalancing";

export interface Finding {
  id: string;
  category: FindingCategory;
  severity: Severity;
  title: string;
  detail: string;
  /** Approximate dollars at risk / lost if unaddressed. */
  dollarsAtRisk?: number;
  /** Annual opportunity in dollars (yield). */
  opportunityPerYear?: number;
  /** Which marketplace category could fix this (maps to registry agents). */
  /** Machine-readable source for the UI card. */
  data: Record<string, unknown>;
}

const LIQ_PENALTY = 0.1; // Venus ~10% liquidation penalty
const VENUS_CLOSE_FACTOR = 0.5; // verified onchain (0.5 mantissa)

export interface Diagnosis {
  findings: Finding[];
  healthy: boolean;
  totalAtRisk: number;
  totalOpportunityPerYear: number;
  checked: string[];
}

export async function diagnose(scan: ScanResult): Promise<Diagnosis> {
  const findings: Finding[] = [];
  const checked: string[] = [];

  // ---- Health factor (Venus) ----
  if (scan.venus) {
    checked.push("Venus");
    const v = scan.venus;
    if (v.totalBorrowUsd > 0) {
      const hf = v.healthFactor;
      const dollarsAtRisk = Math.min(v.totalBorrowUsd * VENUS_CLOSE_FACTOR, v.weightedCollateralUsd) * LIQ_PENALTY;
      if (hf <= 1.05) {
        findings.push({
          id: "venus-liquidation-imminent",
          category: "health_factor",
          severity: "critical",
          title: `Your Venus position liquidates if ${v.dominantCollateralSymbol || "collateral"} falls ${v.liquidationDropPct.toFixed(1)}% more`,
          detail: `Health factor is ${hf.toFixed(2)}. At liquidation, up to ${Math.round(dollarsAtRisk).toLocaleString()} USD of collateral is taken at a penalty.`,
          dollarsAtRisk: Math.round(dollarsAtRisk),
          data: { protocol: "Venus", healthFactor: hf, liquidationDropPct: v.liquidationDropPct, totalBorrowUsd: v.totalBorrowUsd },
        });
      } else if (hf <= 1.2) {
        findings.push({
          id: "venus-liquidation-warning",
          category: "health_factor",
          severity: "warning",
          title: `Venus health factor ${hf.toFixed(2)} — a ${v.liquidationDropPct.toFixed(1)}% drop liquidates you`,
          detail: `Borrowed ${Math.round(v.totalBorrowUsd).toLocaleString()} USD against ${v.dominantCollateralSymbol || "collateral"}. One sharp move can trigger liquidation.`,
          dollarsAtRisk: Math.round(dollarsAtRisk),
          data: { protocol: "Venus", healthFactor: hf, liquidationDropPct: v.liquidationDropPct, totalBorrowUsd: v.totalBorrowUsd },
        });
      } else if (hf <= 1.35) {
        findings.push({
          id: "venus-liquidation-watch",
          category: "health_factor",
          severity: "info",
          title: `Venus health factor ${hf.toFixed(2)} is thin`,
          detail: `You have ${Math.round((hf - 1) * 100).toLocaleString()}% headroom before liquidation risk.`,
          dollarsAtRisk: Math.round(dollarsAtRisk),
          data: { protocol: "Venus", healthFactor: hf, liquidationDropPct: v.liquidationDropPct },
        });
      }
    }
  }

  // ---- Health factor (Aave) ----
  if (scan.aave) {
    checked.push("Aave V3");
    const a = scan.aave;
    if (a.totalDebtUsd > 0 && a.healthFactor !== Infinity) {
      const hf = a.healthFactor;
      const dollarsAtRisk = a.totalDebtUsd * a.liquidationThreshold * LIQ_PENALTY;
      if (hf <= 1.05) {
        findings.push({
          id: "aave-liquidation-imminent",
          category: "health_factor",
          severity: "critical",
          title: `Aave position at liquidation threshold (HF ${hf.toFixed(2)})`,
          detail: `Debt ${Math.round(a.totalDebtUsd).toLocaleString()} USD. Collateral is ${a.liquidationDropPct.toFixed(1)}% from the liquidation point.`,
          dollarsAtRisk: Math.round(dollarsAtRisk),
          data: { protocol: "Aave V3", healthFactor: hf, liquidationDropPct: a.liquidationDropPct },
        });
      } else if (hf <= 1.2) {
        findings.push({
          id: "aave-liquidation-warning",
          category: "health_factor",
          severity: "warning",
          title: `Aave health factor ${hf.toFixed(2)} — ${a.liquidationDropPct.toFixed(1)}% drop liquidates you`,
          detail: `Keep collateral above the ${Math.round(a.liquidationThreshold * 100).toLocaleString()}% liquidation threshold.`,
          dollarsAtRisk: Math.round(dollarsAtRisk),
          data: { protocol: "Aave V3", healthFactor: hf, liquidationDropPct: a.liquidationDropPct },
        });
      }
    } else if (a.totalCollateralUsd > 0) {
      // collateral only, no debt — opportunity: could be borrowed against (skip for MVP, avoid complexity)
    }
  }

  // ---- LP ranges (PCS V3) ----
  if (scan.v3) {
    checked.push("PancakeSwap V3");
    for (const pos of scan.v3.positions) {
      if (!pos.inRange) {
        findings.push({
          id: `v3-range-${pos.tokenId}`,
          category: "lp_range",
          severity: "warning",
          title: `Your ${pos.symbol0}/${pos.symbol1} position is out of range`,
          detail: `Price moved outside ${pos.lowerPrice.toFixed(6)}–${pos.upperPrice.toFixed(6)}. It is earning no trading fees.`,
          dollarsAtRisk: Math.round(pos.sizeUsd),
          data: { tokenId: pos.tokenId, symbol0: pos.symbol0, symbol1: pos.symbol1, sizeUsd: pos.sizeUsd, inRange: false },
        });
      }
    }
  }

  // ---- Idle stablecoins ----
  if (scan.idleStables.length > 0) {
    checked.push("Idle stablecoins");
    const spread = await stableYieldSpread();
    const best = await bestStablePool();
    const targetApy = best?.apyMean30d ?? spread?.p90Apy ?? 5;
    for (const s of scan.idleStables) {
      const opp = s.usd * (targetApy / 100);
      findings.push({
        id: `idle-${s.symbol}`,
        category: "idle_yield",
        severity: s.usd >= 1000 ? "info" : "info",
        title: `${s.usd >= 1000 ? "≈" : ""}${Math.round(s.usd).toLocaleString()} USD ${s.symbol} is sitting idle`,
        detail: `Best BSC stable pools earn ~${targetApy.toFixed(1)}% APY. You are earning 0% on this.`,
        opportunityPerYear: Math.round(opp),
        data: { symbol: s.symbol, usd: s.usd, targetApy },
      });
    }
  }

  const totalAtRisk = findings.reduce((s, f) => s + (f.dollarsAtRisk ?? 0), 0);
  const totalOpportunityPerYear = findings.reduce((s, f) => s + (f.opportunityPerYear ?? 0), 0);

  return {
    findings,
    healthy: findings.length === 0,
    totalAtRisk,
    totalOpportunityPerYear,
    checked,
  };
}
