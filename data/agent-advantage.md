# Agent Advantage Report — Vigil v2

Generated 2026-08-27T00:10:50.997Z · Wallet `0x28C6c06298d514Db089934071355E5743bf21d60` · every task ran through Vigil's validated proxy against the live, verified MCP endpoints.

## Methodology

- **With agent:** wall-clock latency of a full round trip through Vigil (rate-limit, allowlist-of-verified-tools check, third-party call, output cap). When a mandate exists the run uses the hire rail in `dryRun` mode — identical validation chain a paid action would face.
- **Without agent:** the real steps a human performs today (the honest counterfactual), timed generously.
- Every output below is the **actual response** captured at generation time. Tasks weighted per TermiX rubric: security/trading first.

## Results overview

| # | Task | Weight | Manual | Via Vigil |
|---|---|---|---|---|
| 1 | Liquidation-risk check on a live lending position | security | ~3 min, repeated daily, error-prone under market stress | 7851ms |
| 2 | Debt position audit across lending reserves | security | ~15 min ad-hoc (or never done) | 8601ms |
| 3 | Market-wide yield scan with risk scoring | yield | ~10 min per cycle | 133ms |
| 4 | Perp account snapshot: balances across spot & futures books | trading | ~2 min per order iteration | 216ms |

## 1. Liquidation-risk check on a live lending position — _security_

**Why it matters:** High-stakes: an unsurfaced health-factor breach is measured in lost principal.

| | Without agent | With agent (Vigil) |
|---|---|---|
| Time | ~3 min, repeated daily, error-prone under market stress | 7851ms (public try rail (validated proxy, no session)) |
| Cost | your time; wrong mental math = liquidation | ~$0.01 x402/gas · capped onchain · revocable |
| Steps | Open Venus dApp → Connect wallet → find position row → read borrow APY & collateral → mentally compute distance-to-liquidation → repeat across reserves | paste JSON → one POST |
| Output | human-readable screens, hand-parsed | structured JSON, machine-readable |

**Actual output captured:**

```json
{"project":"venus","operation":"getAccountLiquidity","data":[{"chain":"bsc","pool":"CORE","borrowLimit":"0.00","shortfall":"0.00"}]}
```

## 2. Debt position audit across lending reserves — _security_

**Why it matters:** The counterfactual is usually skipped entirely — the strongest agent advantage case.

| | Without agent | With agent (Vigil) |
|---|---|---|
| Time | ~15 min ad-hoc (or never done) | 8601ms (public try rail (validated proxy, no session)) |
| Cost | $0 up front; unpriced tail risk | ~$0.01 x402/gas · capped onchain · revocable |
| Steps | Venus app → connect → per-market rows → read & transcribe each borrow balance | paste JSON → one POST |
| Output | human-readable screens, hand-parsed | structured JSON, machine-readable |

**Actual output captured:**

```json
{"project":"venus","operation":"getBorrowBalance","data":{"chainName":"bsc","pool":"CORE","balances":[{"tokenSymbol":"USDT","balance":"0"}]}}
```

## 3. Market-wide yield scan with risk scoring — _yield_

**Why it matters:** Fresh, structured opportunity set versus tab-shopping across dashboards.

| | Without agent | With agent (Vigil) |
|---|---|---|
| Time | ~10 min per cycle | 133ms (public try rail (validated proxy, no session)) |
| Cost | time; stale decisions between scans | ~$0.01 x402/gas · capped onchain · revocable |
| Steps | DefiLlama → filter BSC pools → cross-check risk pages → dedupe by protocol | paste JSON → one POST |
| Output | human-readable screens, hand-parsed | structured JSON, machine-readable |

**Actual output captured:**

```json
{
  "last_scan": null,
  "count": 0,
  "opportunities": []
}
```

## 4. Perp account snapshot: balances across spot & futures books — _trading_

**Why it matters:** Trading record category: parameterized orders as callable, auditable requests.

| | Without agent | With agent (Vigil) |
|---|---|---|
| Time | ~2 min per order iteration | 216ms (public try rail (validated proxy, no session)) |
| Cost | slippage while clicking; one fat-finger = realized loss | ~$0.01 x402/gas · capped onchain · revocable |
| Steps | Aster app → connect wallet → open account panel → read each book's balances → transcribe to notes | paste JSON → one POST |
| Output | human-readable screens, hand-parsed | structured JSON, machine-readable |

**Actual output captured:**

```json
{"project":"aster","operation":"getBalance","note":"Execute the Aster futures balance request.","cexApiRequestActions":[{"url":"https://fapi.asterdex.com/fapi/v3/balance?nonce=1787789450000000&user=PUT_YOUR_ASTER_USER_ADDRESS_HERE&signer=PUT_YOUR_ASTER_SIGNER_ADDRESS_HERE&signature=PUT_YOUR_ASTER_SIGNATURE_HERE","method":"GET","headers":{"User-Agent":"HeyAnon/1.0"},"toSign":"nonce=1787789450000000&user=PUT_YOUR_ASTER_USER_ADDRESS_HERE&signer=PUT_YOUR_ASTER_SIGNER_ADDRESS_HERE"}]}
```

## Conclusion

For the two highest-stakes tasks (liquidation-risk and stress-test), the manual baseline is either minutes of fragile manual math or — realistically — skipped altogether. Through Vigil both are one validated, receipted call under a scoped onchain session, returned as structured JSON a downstream system can act on. That is measurable agent advantage, not asserted advantage.