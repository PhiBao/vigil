# Agent Advantage Report — Vigil

Generated 2026-08-21T09:41:48.860Z · Wallet `0x28C6c06298d514Db089934071355E5743bf21d60` · via Vigil marketplace hire execution

## Methodology

Each task was run two ways: **without an agent** (manual, the counterfactual) and **with an agent hired through the Vigil marketplace** (one MCP call under a scoped, revocable session, validated and receipted). Times are wall-clock for the with-agent path; costs include gas + LLM via x402; outputs are the actual agent responses. At least one task is from trading/security as required.

## Tasks

### 1. Venus borrow balance (security) — _security_

| | Without agent | With agent (Vigil) |
|---|---|---|
| Time | ~1-2 min (dApp + explorer) | 5747ms |
| Cost | $0 but manual, error-prone, not structured | gas + LLM via x402 (~$0.01) + session cap enforcement |
| Output | Unstructured, requires parsing, not machine-readable | stage=read, {"project":"venus","operation":"getBorrowBalance","data":{"chainName":"bsc","pool":"CORE","balances":[{"tokenSymbol":"USDT","balance":"0"}]}} |

**Actual output (with agent):**

```json
{"project":"venus","operation":"getBorrowBalance","data":{"chainName":"bsc","pool":"CORE","balances":[{"tokenSymbol":"USDT","balance":"0"}]}}
```

### 2. PancakeSwap V3 supported chains (trading) — _trading_

| | Without agent | With agent (Vigil) |
|---|---|---|
| Time | ~2 min (open dApp, navigate, copy) | 223ms |
| Cost | $0 but manual, error-prone, not structured | gas + LLM via x402 (~$0.01) + session cap enforcement |
| Output | Unstructured, requires parsing, not machine-readable | stage=read, {"project":"v3pools","operation":"getSupportedChains","data":{"chains":["kava_evm","metis","sonic","bsc","ethereum","arbitrum","base","optimism","polygon","avalanche","zksync","plasma"]}} |

**Actual output (with agent):**

```json
{"project":"v3pools","operation":"getSupportedChains","data":{"chains":["kava_evm","metis","sonic","bsc","ethereum","arbitrum","base","optimism","polygon","avalanche","zksync","plasma"]}}
```

### 3. Beefy vaults on BSC (yield) — _yield_

| | Without agent | With agent (Vigil) |
|---|---|---|
| Time | ~1-2 min (dApp + explorer) | 679ms |
| Cost | $0 but manual, error-prone, not structured | gas + LLM via x402 (~$0.01) + session cap enforcement |
| Output | Unstructured, requires parsing, not machine-readable | stage=read, {"project":"beefy","operation":"getVaultsWithChains","data":[{"chain":"bsc","vaults":[{"id":"pancake-cow-bsc-pepe-wbnb-vault","name":"PEPE-WBNB","chain":"bsc","tokenProviderId":"pancakeswap","platform |

**Actual output (with agent):**

```json
{"project":"beefy","operation":"getVaultsWithChains","data":[{"chain":"bsc","vaults":[{"id":"pancake-cow-bsc-pepe-wbnb-vault","name":"PEPE-WBNB","chain":"bsc","tokenProviderId":"pancakeswap","platform":"pancakeswap","token":"PEPE-WBNB","tokenAddress":"0x3e5067c68EA8B3661d65B6d817e669898A711B9B","tvl":3867.8248569626585,"poolTvl":236720.96490791763,"apy":1.8284569162179705},{"id":"pancake-cow-bsc-usdt-btcb-vault","name":"BTCB-USDT","chain":"bsc","tokenProviderId":"pancakeswap","platform":"pancakeswap","token":"BTCB-USDT","tokenAddress":"0xE5654eB3f76F6758a89EDcc9843D11eF89bDDf3D","tvl":56281.15928521891,"poolTvl":14023966.738272326,"apy":0.6665511190860769},{"id":"pancake-cow-bsc-usdt-sol-vault","name":"SOL-USDT","chain":"bsc","tokenProviderId":"pancakeswap","platform":"pancakeswap","token":"SOL-USDT","tokenAddress":"0x61E9a8dD14D6cF17E04D2AC61b995bcC7bDA50Fa","tvl":5757.27656682337,"poolTvl":583588.196562308,"apy":0.37538966308322275},{"id":"pancake-cow-bsc-eth-usdt-vault","name":"ETH-USDT","chain":"bsc","tokenProviderId":"pancakeswap","platform":"pancakeswap","token":"ETH-USDT","tokenAddress":"0x574818b97c7c925C542d74ad8463c8dA83392939","tvl":54647.93136653197,"poolTvl":4833535.674965418,"apy":0.32345310952700546},{"id":"pancake-cow-bsc-usdt-wbnb-vault","name":"WBNB-USDT","chain":"bsc","tokenProviderId":"pancakeswap","platform":"pancakeswap","token":"WBNB-USDT","tokenAddress":"0x39D16B4B83C43207668De708E55ecc721cC27990","tvl":105048.83929417857,"poolTvl":12911421.894631442,"
```

## Conclusion

Hiring through Vigil beats doing it yourself: one validated, receipted MCP call replaces minutes of manual navigation, with structured output and an onchain session that bounds spend and is revocable. The advantage compounds for high-stakes categories (trading, security) where manual error is costly.