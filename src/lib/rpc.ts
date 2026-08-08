import { createPublicClient, fallback, http, type PublicClient, type Chain } from "viem";
import { ADDRESSES } from "../config";

/**
 * BSC RPC access with failover.
 *
 * During discovery (Aug 2026) half the "public" BSC RPCs returned null/garbage
 * (rpc.ankr.com/bsc, binance.llamarpc.com both failed). We therefore use a
 * viem `fallback` transport over the endpoints that verified live, ranked by
 * measured health. viem fallback retries and tracks latency automatically.
 */

const mainnetUrls = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed1.ninicoin.io",
];

const testnetUrls = [
  "https://bsc-testnet-rpc.publicnode.com",
  "https://bsc-testnet.bnbchain.org",
];

export const bscChain = {
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: mainnetUrls } },
  contracts: {
    multicall3: { address: ADDRESSES.multicall3 },
  },
} as const satisfies Chain;

export const bscTestnetChain = {
  id: 97,
  name: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: testnetUrls } },
  contracts: {
    multicall3: { address: ADDRESSES.multicall3 },
  },
} as const satisfies Chain;

function makeClient(urls: string[], chain: Chain): PublicClient {
  return createPublicClient({
    chain,
    transport: fallback(
      urls.map((u) =>
        http(u, {
          retryCount: 2,
          timeout: 10_000,
        }),
      ),
      { rank: true },
    ),
    // batch multicall3 (used by scanner)
    batch: { multicall: { batchSize: 512 } },
  });
}

/** Mainnet public client (batch + failover). */
export const publicClient = makeClient(mainnetUrls, bscChain);

/** Testnet public client. */
export const publicTestnetClient = makeClient(testnetUrls, bscTestnetChain);

/** Pick a client by chain id. */
export function getPublicClient(chainId: number): PublicClient {
  return chainId === 56 ? publicClient : publicTestnetClient;
}
