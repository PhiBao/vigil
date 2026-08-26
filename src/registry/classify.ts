import type { Category } from "./model";

/**
 * Deterministic capability classifier.
 *
 * CORE RULE: a category is assigned ONLY when it is backed by at least one
 * TOOL-SIGNATURE hit. The description is self-declared marketing copy and can
 * never, on its own, earn a category. It is still parsed — but only to produce
 * `claimedOnly`, the set of categories the publisher advertises that the tool
 * signature does NOT support. That gap is the mislabeling this marketplace
 * exists to expose, so we surface it instead of silently trusting it.
 *
 * Tuned against the live BSC corpus (measured, not assumed): 103 distinct MCP
 * endpoints, 20 reachable, whose real `tools/list` output drove the rules
 * below. Notable false positives that shaped them:
 *   - a fiat payment agent exposing `create_order`/`confirm_order` was landing
 *     in `grid`. Generic business nouns ("order", "position", "buy") are NOT
 *     evidence of onchain market execution; "swap"/"exactInput" are.
 *   - a contract-audit agent was landing in `yield` purely from the word
 *     "reward" in its description.
 *   - an attestation/proof agent was landing in `grid` and `health_factor`.
 */

interface Rule {
  category: Category;
  /**
   * Substrings matched against the tool name with separators stripped.
   * Use for multi-word signatures that are unambiguous when joined
   * (e.g. "exactinput", "getaccountliquidity").
   */
  full: string[];
  /** Exact token matches (camelCase / snake_case / space split). */
  tokens: string[];
  /**
   * Flattened substrings that VETO this tool for this category, even if a
   * token matched. Each entry below is a measured false positive from the live
   * corpus, kept as a regression guard.
   */
  exclude?: string[];
  /**
   * Description-only signals. These NEVER assign a category; they only mark a
   * publisher claim, which we compare against the tool evidence.
   */
  claims: string[];
}

const RULES: Rule[] = [
  {
    category: "health_factor",
    full: [
      "getaccountliquidity",
      "accountliquidity",
      "healthfactor",
      "repayborrow",
      "getborrow",
      "borrowbalance",
      "liquidat",
      "stresstest",
      "getrisk",
      "riskscore",
      "collateral",
      "emode",
    ],
    tokens: ["borrow", "repay", "collateral", "loan", "debt", "liquidate", "risk", "ltv"],
    // A perps venue's `changeMarginType` / `setLeverage` is margin *config*, a
    // different risk primitive from a lending health factor. Routing a Venus
    // borrower's liquidation-protection mandate to a perps DEX would be unsafe,
    // so bare "margin"/"leverage" is deliberately not health_factor evidence.
    exclude: ["margintype", "marginsettings", "positionmargin"],
    claims: ["liquidation", "health factor", "liquidat", "undercollateral", "margin call"],
  },
  {
    category: "rebalancing",
    full: [
      "increaseliquidity",
      "decreaseliquidity",
      "rebalance",
      "recenter",
      "autocompound",
      "compoundfees",
      "collectfees",
      "createposition",
      "estimateranges",
      "recommendlp",
    ],
    tokens: ["rebalance", "recenter", "compound", "tick", "range", "reposition"],
    claims: ["rebalanc", "out of range", "concentrated liquidity", "recenter"],
  },
  {
    category: "yield",
    full: [
      "supplyapr",
      "borrowapr",
      "getsupplyapy",
      "stakerate",
      "yieldopportun",
      "getopportunities",
      "harvest",
      "claimrewards",
      "getvault",
      "depositclm",
      "scanprotocols",
    ],
    tokens: ["apr", "apy", "yield", "harvest", "stake", "unstake", "restake", "reward", "rewards", "vault", "vaults", "supply", "redeem", "minttoken", "gauge", "bribe"],
    // "supply" means lending-supply in `supply()`, but token economics in
    // `circulating_supply` / `total_supply`. The latter is a price metric.
    exclude: ["circulatingsupply", "totalsupply", "maxsupply", "supplyof"],
    claims: ["yield", "apr", "apy", "auto-compound", "farm", "earn"],
  },
  {
    category: "grid",
    // Onchain market execution only. A generic "order"/"position"/"buy" is not
    // evidence — those appear in payment, betting, and CRM agents alike.
    full: [
      "exactinput",
      "exactoutput",
      "gridtrade",
      "limitorder",
      "triggerorder",
      "trailingstop",
      "stoplosstakeprofit",
      "buildswapcalldata",
      "quoteswap",
      "swapexact",
      "closeposition",
      "setleverage",
    ],
    tokens: ["swap", "swapevm", "grid", "leverage", "long", "short", "perp", "perps"],
    // Aave's `swapBorrowRateMode` swaps an interest-rate mode, not an asset.
    exclude: ["borrowratemode", "swaprate"],
    claims: ["grid trading", "grid bot", "dca", "limit order", "take profit", "stop loss"],
  },
  {
    category: "monitoring",
    full: [
      "getprice",
      "getbalance",
      "multichainbalance",
      "watchwallet",
      "getmarkets",
      "getportfolio",
      "getperformance",
      "getpositions",
      "getstatus",
      "getmetrics",
      "getstats",
      "freshness",
      "dailydigest",
      "webhookregister",
      "scanbottoms",
      "scantops",
      "evaluatesymbol",
      "poolscan",
      "getpoolstats",
      "getprotocolstats",
    ],
    tokens: [
      "watch",
      "monitor",
      "track",
      "alert",
      "alerts",
      "portfolio",
      "pnl",
      "price",
      "prices",
      "balance",
      "balances",
      "status",
      "stats",
      "metrics",
      "scan",
      "digest",
      "signal",
      "signals",
      "census",
    ],
    claims: ["monitor", "watch 24", "alert", "track", "notif", "dashboard"],
  },
];

/** Split a tool name into normalized tokens (camelCase + separators). */
function tokensOf(name: string): string[] {
  const camel = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return camel.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
}

const flatten = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const emptyReasons = (): Record<Category, string[]> => ({
  health_factor: [],
  rebalancing: [],
  yield: [],
  grid: [],
  monitoring: [],
});

export interface Classification {
  /** Assigned categories — every one backed by tool-signature evidence. */
  categories: Category[];
  /** Auditable evidence per category. `desc:` entries are claims, not proof. */
  reasons: Record<Category, string[]>;
  /**
   * Categories the description advertises but the tool signature does not
   * support. Rendered as "publisher claim, unverified" — never as capability.
   */
  claimedOnly: Category[];
}

export function classify(tools: string[], description: string): Classification {
  const reasons = emptyReasons();
  const fromTools = new Set<Category>();
  const fromDesc = new Set<Category>();

  const descNorm = (description ?? "").toLowerCase();
  const prepared = tools.map((t) => ({ raw: t, flat: flatten(t), toks: tokensOf(t) }));

  for (const rule of RULES) {
    for (const t of prepared) {
      if (rule.exclude?.some((x) => t.flat.includes(x))) continue;
      for (const sig of rule.full) {
        if (t.flat.includes(sig)) {
          reasons[rule.category].push(`${sig}@${t.raw}`);
          fromTools.add(rule.category);
        }
      }
      for (const sig of rule.tokens) {
        if (t.toks.includes(sig)) {
          reasons[rule.category].push(`token:${sig}@${t.raw}`);
          fromTools.add(rule.category);
        }
      }
    }
    for (const sig of rule.claims) {
      if (descNorm.includes(sig)) {
        reasons[rule.category].push(`desc:${sig}`);
        fromDesc.add(rule.category);
      }
    }
  }

  // Tool evidence is the only thing that assigns a category. An agent with no
  // reachable tools is UNCLASSIFIED, not a monitor — declaring a capability
  // without evidence is exactly the failure this marketplace exists to fix.
  const categories = [...fromTools];
  const claimedOnly = [...fromDesc].filter((c) => !fromTools.has(c));
  return { categories, reasons, claimedOnly };
}
