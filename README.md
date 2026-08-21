# Vigil

  **The agent marketplace for BNB Smart Chain.**

  Browse AI agents registered under ERC-8004 on BSC — health factor protection, LP rebalancing, yield routing, grid trading — classified by **what their tools actually do**, verified by **live endpoint checks**, and hireable under **scoped, revocable, onchain sessions**.

  > Find an agent that fixes your money. Not one that just describes it.

Built for the **Build the Era** hackathon (BNB Chain, Aug 5 – Sep 9 2026): *"Build the official BNB Agent Studio marketplace."*

---

## Why this exists

BNB Chain hosts ~250,000 ERC-8004 agents — more than any other network. But you can't find them:

- Agent descriptions and names are **self-declared and often empty** (`tags: []`, `categories: []`)
- The capability lives in the **tool signature** (e.g. `getAccountLiquidity`, `repayBorrow`), not the marketing copy
- Registry feedback is sybil-farmed (all BSC feedbacks we sampled came from one address)
- Semantic search on the canonical API is unreliable (502), and its capability filters are ignored

Vigil fixes the indexing, not the supply: it classifies agents by their exposed tool signatures and verifies their endpoints live. The shelves aren't empty — they're mislabeled. This marketplace makes the label.

---

## How it works

```
                     ┌──────────────────────────────────────────────┐
                     │                  BSC (chain 56)              │
                     │   ERC-8004 registry · 250k agents            │
                     └───────────────────┬──────────────────────────┘
                                         │ protocol=MCP filter (verified)
                                         ▼
                     ┌──────────────────────────────────────────────┐
                     │  REGISTRY PIPELINE                           │
                     │  ingest → classify → verify → persist        │
                     │  (background worker, rate-limited)           │
                     └───────────────────┬──────────────────────────┘
                                         │
                  ┌──────────────────────┼──────────────────────┐
                  ▼                      ▼                      ▼
        ┌───────────────┐        ┌───────────────┐       ┌──────────────┐
        │  BROWSE       │        │  SCAN         │       │  HIRE        │
        │  by category  │        │  any wallet   │       │  passkey +   │
        │  equal depth  │        │  → findings   │       │  scoped      │
        │  × 4 + monitor│        │  → matched    │       │  session     │
        └───────────────┘        │    agents     │       │  (Altana)    │
                                 └───────────────┘       └──────────────┘
```

**Three user paths:**

1. **Browse** — category pages built from the verified index. Each agent card shows the tool signatures that placed it, verification freshness, uptime, and x402 payability. Classification is deterministic and auditable (each assignment carries the rule that fired).

2. **Scan** — paste any BSC wallet. We read Venus, Aave V3, PancakeSwap V3, and idle stablecoin positions and return dollar-quantified findings. Each finding is matched to real registry agents that fix it. Read-only, no connection, no signup.

3. **Hire** — approve with a passkey (Face ID / Touch ID). We create an Altana smart-account wallet on your device, grant a scoped session (contract allowlist + daily spend cap + expiry), register the key in the onchain Keystore, and route requests to the third-party agent's MCP endpoint. **The agent proposes actions; your session decides.** Every calldata it returns is validated (target allowlist, selector check, approval checks, live simulation) before submission, and the onchain session is the final backstop.

---

## Architecture

```
src/
├── app/                          # Next.js App Router (server components default)
│   ├── page.tsx                  # landing (browse + scan entry)
│   ├── browse/[category]/        # marketplace category pages
│   ├── agent/[agentId]/          # agent evidence page (auditable classification)
│   ├── hire/[agentId]/           # consent + passkey hire flow
│   ├── scan/[address]/           # position scan result
│   ├── watch/[address]/          # receipts inbox + revocation
│   └── api/
│       ├── scan/                 # scan + diagnosis + matched agents
│       ├── mandates/             # create / list mandates (session stored encrypted)
│       ├── mandates/[id]/revoke/ # two-step onchain revocation
│       └── agent/                # registry stats + on-demand verification
│
├── registry/                     # the marketplace core
│   ├── model.ts                  # AgentRecord, categories
│   ├── ingest.ts                 # 8004scan protocol=MCP ingest → AgentRecord
│   ├── classify.ts               # deterministic tool-signature → category
│   ├── verify.ts                 # live tools/list checks (cached, throttled)
│   ├── verify-run.ts             # background verification batches
│   ├── mcp.ts                    # MCP streamable-HTTP client (tools/list, tools/call)
│   └── queries.ts                # read-side queries for the UI
│
├── scanner/                      # position reading (read-only, RPC + multicall)
│   ├── venus.ts                  # health factor + liquidation sensitivity
│   ├── aave.ts                   # Aave V3 account data
│   ├── pancake-v3.ts             # V3 positions: in-range, amounts, size
│   ├── balances.ts               # idle stablecoin detection
│   ├── yields.ts                 # DefiLlama BSC pool APYs
│   └── abis.ts
│
├── diagnose/                     # scan state → dollar-quantified findings
├── mandate/
│   └── permissions.ts            # category → onchain session allowlists
├── hire/
│   └── validate-calldata.ts      # SECURITY: third-party calldata validation
├── runtime/
│   └── executor.ts               # Altana session execution (server-side)
├── db/                           # storage (Postgres or file store)
│   ├── store.ts                  # storage interface
│   ├── index.ts                  # Postgres implementation
│   └── file-store.ts             # dev/demo file implementation
└── lib/                          # rpc (failover), money, secrets, throttle, rate-limit, env, logger

scripts/                          # dev + ops
├── ingest-registry.mts           # batch ingest + per-category supply report
├── verify-worker.mts             # background ingest + verification loop
├── verify-heyanon.mts            # verify the known-good HeyAnon family
├── index-venus.mts               # vertical slice: index + classify + verify
├── hire-simulate.mts             # call a third-party MCP tool, validate calldata
├── roundtrip-testnet.mts         # Altana grant→execute→enforce→revoke proof
├── agent-advantage.mts           # TermiX Agent Advantage Report generator
├── setup-testnet.mts             # generate testnet key + print funding address
└── test-scan.mts                 # scan batch of addresses
```

---

## Tech stack

- **Next.js 16** (App Router, Turbopack, server components) · **TypeScript** (strict)
- **Tailwind CSS 4**
- **viem** — typed BSC reads, multicall3, calldata encode/decode, simulation
- **@altananetwork/sdk** — non-custodial agent wallets, scoped sessions, Keystore, x402
- **DefiLlama** (yields API) · **DexScreener** (prices) · **8004scan** (ERC-8004 index)
- **postgres** (porsager) with a **file-store fallback** so the app runs with zero infra
- **pino** logging · **pnpm** package manager

---

## Setup

```bash
pnpm install
cp .env.example .env.local   # optional; app runs with sensible defaults
pnpm dev                     # http://localhost:3000
```

**Environment variables** (all optional unless noted):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres URL. If unset, a file store at `data/vigil.json` is used (dev/demo). |
| `MANDATE_ENCRYPTION_KEY` | AES-256-GCM key for encrypting agent session keys at rest. **Set in production** (a dev key is used with a warning otherwise). |
| `AGENT_RUN_KEY` | Protects the `?op=verify` and `confirm=1` endpoints. |
| `RATE_LIMIT_PER_MIN` | Raises the external-API throttle (default 8/min, the anonymous 8004scan tier). |
| `LOG_LEVEL` | pino level. |

---

## The data model

### AgentRecord (what the marketplace renders)

Each agent row is built from the 8004scan registry **plus our own verification**, never from raw metadata alone:

- `agentId` (`chain:registry:token`), name, description, owner, wallet
- `categories` + `categoryReasons` — **why** each category was assigned (the exact tool signatures that fired)
- `protocols`, `x402`, service endpoints (MCP / A2A / web)
- Verification state: `verifiedAt`, `healthStatus`, `uptimeChecks`/`uptimeOk`, verified tool list

### Classifier (deterministic, auditable)

Category assignment comes from **tool signatures**, token-aware to avoid substring collisions:

| Category | Example triggers |
|---|---|
| `health_factor` | `getAccountLiquidity`, `repayBorrow`, `borrow`, `healthfactor`, `liquidat` |
| `rebalancing` | `increaseLiquidity`, `decreaseLiquidity`, `rebalance`, `tick`, `recenter` |
| `yield` | `getSupplyAPR`, `getBorrowAPR`, `mintToken`, `redeem`, `stake`, `harvest` |
| `grid` | `exactInput`, `swap`, `buy`, `sell`, `limit order`, `grid` |
| `monitoring` | `getPrice`, `getBalance`, `watch`, `alert`, `pnl` |

No LLM. No fallback to "monitoring" for unclassified agents — an agent with no verified tools is honestly unclassified.

### Storage

`Store` interface with two implementations:
- **Postgres** (`DATABASE_URL` set): `mandates`, `receipts`, `proving_runs`, `agents` tables.
- **File store** (`data/vigil.json`): atomic-ish writes, Date revival, zero setup.

---

## Security model

This product lets a **third-party** propose onchain actions for a user's wallet. Security is defense in depth:

1. **Non-custodial by construction** — Altana wallets: the user's admin key lives in device secure hardware (WebAuthn passkey). Vigil never holds it.
2. **Scoped sessions, enforced onchain** — every mandate is `calls` (contract allowlist) + `spend` (daily cap) + `expiry`, registered in the public Keystore. Omitting `calls` is impossible by type. Revocation is one transaction and immediate. **Verified in `scripts/roundtrip-testnet.mts`**: a non-allowlisted call reverts with `UnauthorizedCall`; a call after revoke is rejected.
3. **Calldata validation** (`src/hire/validate-calldata.ts`) — before any third-party calldata is submitted: target must be in the allowlist, selector must be known/permitted, `approve` must name only allowlisted spenders, amount must fit the cap, and `eth_call` simulation must pass.
4. **Onchain backstop** — even if our validator is wrong, loss is bounded by the session permissions.
5. **Session keys encrypted at rest** — AES-256-GCM with `MANDATE_ENCRYPTION_KEY`.
6. **Untrusted input discipline** — all registry/agent metadata is schema-validated; agent text is never executed as HTML or injected into context unescaped.
7. **Rate limiting** — public scan endpoint rate-limited; verification is throttled and never on the user-facing path.
8. **Resilience** — RPC pool with failover (half the free BSC RPCs are broken — verified); 8004scan semantic search is never a hard dependency.

---

## Scripts & workflows

```bash
# Altana round-trip proof (needs funded testnet wallet — see below)
pnpm tsx scripts/roundtrip-testnet.mts

# Build the registry index + report per-category supply
pnpm tsx scripts/ingest-registry.mts [maxPages]

# Background worker: ingest + verify continuously
pnpm tsx scripts/verify-worker.mts --interval=300

# Verify the known-good HeyAnon agent family
pnpm tsx scripts/verify-heyanon.mts

# Vertical slice: index one agent, classify, verify, persist
pnpm tsx scripts/index-venus.mts [tokenId]

# Call a third-party MCP tool and validate its calldata (no funds moved)
pnpm tsx scripts/hire-simulate.mts [tool] [wallet]

# TermiX Agent Advantage Report
pnpm tsx scripts/agent-advantage.mts [--json]

# Scan a batch of addresses
pnpm tsx scripts/test-scan.mts [address ...]
```

### Testnet funding

The Altana testnet relay faucet is a broken stub (verified), so testnet BNB comes from the interactive faucet:

```bash
pnpm tsx scripts/setup-testnet.mts    # prints the wallet address to fund
# fund it at https://testnet.bnbchain.org/faucet-smart
pnpm tsx scripts/roundtrip-testnet.mts
```

---

## How to test the product

1. **Browse**: visit `/browse` — five categories, each showing indexed agents with evidence.
2. **Agent detail**: open an agent → see the auditable classification reasons, verified tool list, uptime, and a "Hire this agent" CTA for hireable agents (x402 + verified MCP + live).
3. **Scan**: paste a public BSC address on the landing page (try `0x28C6c06298d514Db089934071355E5743bf21d60` for an idle-yield finding) → findings are matched to real registry agents.
4. **Hire** (requires a funded wallet + browser passkey): approve with Face ID → scoped session granted → Keystore registration → receipts at `/watch/[wallet]` → revoke in one click.

---

## Sub-tracks (our product fit)

Three partner tracks run alongside the main challenge and are judged independently. Below is how each sponsor's **technology is used inside our product** and what that means — not a restatement of their rules.

### TermiX — measurable agent value

**What we use.** TermiX's open-source **BSC MCP server** is itself an MCP endpoint of the kind our marketplace indexes and live-verifies — it belongs on the same shelves as every other agent. More fundamentally, our marketplace and TermiX share the same core belief: **hiring an agent is only worth it if it measurably beats doing the job yourself.** That belief is baked into our product, not bolted on:

- Every agent card shows verification freshness, uptime, and the exact tool signatures it exposes — the raw material for judging "will this agent actually do the job."
- `scripts/agent-advantage.mts` produces a structured report comparing real tasks run **through our marketplace** (one MCP call, ~1s, structured output) against doing them manually (dApp + explorer, minutes), recording time, cost and output. It is a product output, not a submission document.

**What it means.** The thing TermiX measures — agent advantage — is what our marketplace surfaces on every page. A user deciding between agents is making the same comparison the report makes, in-product, before they spend anything.

### AltLayer / 8004scan — the identity and trust index

**What we use.** Our entire registry pipeline is built on the **8004scan developer API**: the `protocol=MCP` ingest feed, per-agent detail records (ownership, wallet, services, health checks), and reputation/feedback data. It is the supply-side index that our marketplace turns into a demand-side product. The **Pro API tier** (free for participants, 500 req/min vs ~8/min anonymous) is what makes continuous live verification of the whole registry feasible within the build window.

**What it means.** 8004scan solved *discoverability by identity* — who an agent is, what it claims, how it has behaved on-chain. Our product consumes that and adds the missing half: *discoverability by capability* — what the agent's tools actually do, confirmed by probing the live endpoint. We also use 8004scan's data honestly: registry scores and health checks appear on the agent evidence page, and the sybil-farmed feedback we detected (all BSC feedbacks from a single address) is surfaced rather than hidden.

### PancakeSwap — the position substrate

**What we use.** PancakeSwap's **on-chain contracts are the literal allowlists and verification targets** in our product:

- The `rebalancing` and `grid` session allowlists are PancakeSwap contracts — `pancakeV3NPM`, `pancakeV3SwapRouter` — so a hired agent's calldata can only touch PancakeSwap positions, nothing else.
- The **V3 math** (`slot0`, ticks, in-range computation) is the substrate our position scanner reads to diagnose LP positions.
- The agents we index and hire through the marketplace — V3 Pools (LP range management), Token Swaps (bounded swaps) — operate on those same contracts, and our calldata validation (target allowlist, selector check, approval targets, live `eth_call` simulation) enforces that a proposal can never put user funds at risk.

**What it means.** PancakeSwap is the deepest liquidity on BSC, and it is where "smart money" agents are most dangerous to hand authority. Our marketplace makes PancakeSwap automation safe-by-construction: the safety envelope around a hired agent *is* PancakeSwap's own contract set, enforced on-chain by the user's session.

---

## Status & roadmap

Nothing in the build or the sub-tracks requires waiting — the work is executable now, in parallel. The one background process (verification accrual) runs continuously and is not a blocker.

- [x] Registry pipeline: ingest → classify → verify → persist (107 indexed, 17 verified live — HeyAnon family fully covered)
- [x] Marketplace surface: browse (equal depth ×4), agent detail (auditable reasons), scan on-ramp, hire consent
- [x] Altana session rail: grant / execute / enforce / revoke (proven onchain on testnet: `0xa2212cb9…` + `UnauthorizedCall` rejection)
- [x] Calldata validation + simulation for third-party proposals
- [x] Storage (Postgres + file fallback), rate limiting, encrypted keys, RPC failover
- [x] In-product live hire action: tool picker → MCP call → validate → session execution → receipt (read tools: no funds needed; write tools: validated + simulated)
- [x] TermiX Agent Advantage Report: 3 tasks via verified agents (Venus, V3 Pools, Beefy) — `data/agent-advantage.md`
- [x] Altana track: testnet session proven; mainnet is optional for the "stronger" score
- [x] PancakeSwap demo: V3 Pools (LP range) + Token Swaps (bounded swap) via the hire rail, allowlisted to PancakeSwap contracts
- [ ] 8004scan Pro key application → speed up verification (free for participants; anonymous tier is 8/min)
- [ ] Judging-window hardening + judge demo path (polish empty/loading/error states for thin categories)

**Judging window:** Sep 9 – 23. Winner announced Nov 5. The marketplace must stay live and cheap through then. File store is ephemeral on serverless — set `DATABASE_URL` for persistent mandates in production.

---

## Security & compliance notes

- This is a hackathon build. The hire path touches user funds and is designed to be non-custodial and cap-bounded, but **do not fund it with capital you cannot afford to lose** until it has been independently reviewed.
- Registry metadata is untrusted input. Treat all agent descriptions, tool lists, and calldata as attacker-controlled.
- The `data/` directory and all `.env*` files are gitignored and must never be committed.
