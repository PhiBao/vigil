/**
 * Regression tests for the capability classifier.
 *
 * Every case below is real `tools/list` output captured from a live BSC MCP
 * endpoint (or a real registry description). They exist because each one was
 * once mislabeled. Run: pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/registry/classify";

const has = (tools: string[], c: string, desc = "") => classify(tools, desc).categories.includes(c as never);

test("no tools => no categories, however strong the marketing copy", () => {
  const hype =
    "Autonomous 24/7 yield farming agent with liquidation protection, grid trading, " +
    "APR optimization and real-time monitoring alerts for your DeFi portfolio.";
  const r = classify([], hype);
  assert.deepEqual(r.categories, [], "unreachable agents must never be classified");
  // ...but the unbacked claims are surfaced, not discarded.
  assert.ok(r.claimedOnly.length >= 4, "publisher claims should be recorded as unverified");
});

test("publisher claim without tool evidence is reported as claim only", () => {
  // Real case: a contract-audit agent whose description mentions "rewards".
  const r = classify(["sentinels_ai_audit_info", "sentinels_ai_audit_contract"], "earn rewards for audits");
  assert.deepEqual(r.categories, [], "audit tools are not a yield capability");
  assert.deepEqual(r.claimedOnly, ["yield"]);
});

test("fiat payment orders are not grid trading", () => {
  // Real Pretium tools. Generic business nouns must not imply market execution.
  const tools = ["create_order", "confirm_order", "get_order_status", "get_exchange_rate", "validate_account"];
  assert.equal(has(tools, "grid"), false, "'order' alone is not onchain execution evidence");
});

test("prediction-market odds are not grid trading", () => {
  const tools = ["get_markets", "get_odds", "place_bet", "get_metrics", "get_positions"];
  assert.equal(has(tools, "grid"), false);
});

test("token supply metrics are not lending yield", () => {
  // Real BOBAI tools: `circulating_supply` is tokenomics, not a lending supply.
  assert.equal(has(["bobai_circulating_supply", "bobai_price"], "yield"), false);
  // The genuine lending primitive still classifies.
  assert.equal(has(["supply", "withdraw", "borrow"], "yield"), true);
});

test("swapBorrowRateMode is not a market swap", () => {
  // Real Aave tool. It swaps an interest-rate mode, not an asset.
  assert.equal(has(["swapBorrowRateMode", "borrow", "repay"], "grid"), false);
  assert.equal(has(["swapBorrowRateMode", "borrow", "repay"], "health_factor"), true);
});

test("perps margin config is not a lending health factor", () => {
  // Real Aster tools. Routing a Venus liquidation mandate to a perps DEX
  // because both mention "margin" would be unsafe.
  const tools = ["changeMarginType", "modifyPositionMargin", "getLeverageAndMarginSettings", "setLeverage"];
  assert.equal(has(tools, "health_factor"), false);
  assert.equal(has(tools, "grid"), true, "it is still a trading venue");
});

test("real lending agent gets health_factor and yield", () => {
  // Real Venus tools.
  const tools = ["borrow", "repay", "getBorrowBalance", "getBorrowAPR", "getSupplyAPR", "redeemUnderlying"];
  const r = classify(tools, "");
  assert.ok(r.categories.includes("health_factor"));
  assert.ok(r.categories.includes("yield"));
  assert.ok(r.reasons.health_factor.length > 0, "evidence must be auditable");
});

test("real LP agent gets rebalancing", () => {
  // Real Uniswap-V3-style tools.
  const tools = ["increaseLiquidity", "decreaseLiquidity", "collectFees", "createPosition"];
  assert.equal(has(tools, "rebalancing"), true);
});

test("signal scanners are monitoring", () => {
  // Real Bit Monk tools — previously classified as nothing at all.
  assert.equal(has(["scan_bottoms", "scan_tops", "evaluate_symbol"], "monitoring"), true);
});

test("evidence strings name the tool that produced them", () => {
  const r = classify(["getSupplyAPR"], "");
  assert.ok(
    r.reasons.yield.some((x) => x.includes("getSupplyAPR")),
    "each reason must cite its source tool so a user can audit the label",
  );
});
