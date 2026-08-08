import type { Category } from "./model";

/**
 * Deterministic capability classifier. Assigns categories from the TOOL
 * SIGNATURE (not name/description, which are self-declared). Token-aware to
 * avoid substring collisions: "limit" must not match "limitations".
 * Auditable — each assignment carries the rule that fired.
 */

interface Rule {
  category: Category;
  /** Substrings matched against the FULL normalized tool name (≥5 chars to reduce noise). */
  full: string[];
  /** Exact token matches (camelCase/snake/space split). */
  tokens: string[];
  /** Only applied to descriptions (weakest signal), require ≥6 chars. */
  description: string[];
}

const RULES: Rule[] = [
  {
    category: "health_factor",
    full: ["getaccountliquidity", "repayborrow", "healthfactor", "getborrow", "liquidat"],
    tokens: ["borrow", "repay", "collateral", "loan", "debt", "liquidate"],
    description: ["liquidation", "health factor", "liquidat"],
  },
  {
    category: "rebalancing",
    full: ["increaseliquidity", "decreaseliquidity", "rebalance", "recenter", "autocompound", "rebalanceposition"],
    tokens: ["rebalance", "tick", "recenter", "compound"],
    description: ["rebalanc", "out of range", "concentrated liquidity"],
  },
  {
    category: "yield",
    full: ["getsupplyapr", "getborrowapr", "supplyapr", "stakerate", "apy"],
    tokens: ["minttoken", "redeem", "harvest", "stake", "unstake", "yield", "apy", "reward", "vault"],
    description: ["yield", "apr", "apy", "earn", "reward"],
  },
  {
    category: "grid",
    full: ["exactinput", "exactoutput", "gridtrade", "limitorder"],
    tokens: ["swap", "buy", "sell", "trade", "grid", "spot", "order", "position"],
    description: ["grid trading", "trading", "buy", "sell", "swap"],
  },
  {
    category: "monitoring",
    full: ["getprice", "getbalance", "watchwallet", "getmarkets", "alert"],
    tokens: ["watch", "monitor", "track", "alert", "portfolio", "pnl", "price"],
    description: ["monitor", "watch", "alert", "track"],
  },
];

/** Split a tool name into normalized tokens (camelCase + separators). */
function tokensOf(name: string): string[] {
  const camel = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return camel.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
}

export function classify(
  tools: string[],
  description: string,
): { categories: Category[]; reasons: Record<Category, string[]> } {
  const reasons: Record<Category, string[]> = { health_factor: [], rebalancing: [], yield: [], grid: [], monitoring: [] };
  const hits = new Set<Category>();

  const descNorm = (description ?? "").toLowerCase();
  for (const rule of RULES) {
    // 1. Full tool-name substring (strong).
    for (const t of tools) {
      const norm = t.toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const sig of rule.full) {
        if (norm.includes(sig)) {
          reasons[rule.category].push(`${sig}@${t}`);
          hits.add(rule.category);
        }
      }
    }
    // 2. Exact token match (strong).
    for (const t of tools) {
      const toks = tokensOf(t);
      for (const sig of rule.tokens) {
        if (toks.includes(sig)) {
          reasons[rule.category].push(`token:${sig}@${t}`);
          hits.add(rule.category);
        }
      }
    }
    // 3. Description only (weak) — only if not already hit by tools.
    if (!hits.has(rule.category)) {
      for (const sig of rule.description) {
        if (descNorm.includes(sig)) {
          reasons[rule.category].push(`desc:${sig}`);
          hits.add(rule.category);
        }
      }
    }
  }

  const categories = [...hits];
  // Do NOT fall back to "monitoring": an agent with no verified tools is
  // unclassified, not a monitor. Classification quality comes from live
  // verification; declaring a category without evidence is exactly the
  // mislabeling problem this marketplace exists to fix.
  return { categories, reasons };
}
