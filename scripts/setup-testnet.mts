/**
 * Testnet setup: generate/persist the testnet admin key and print the
 * smart-account wallet address that needs funding.
 *
 * The Altana relay's faucet is a stub (verified) and the official BNB testnet
 * faucet requires interactive login, so funding is a one-time manual step.
 *
 * Run: pnpm tsx scripts/setup-testnet.mts
 */
import { http, createPublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { BNB_TESTNET, createClient, signerFromPrivateKey } from "@altananetwork/sdk";
import { loadEnv, persistToEnv } from "../src/lib/env";
import { logger } from "../src/lib/logger";

const publicClient = createPublicClient({
  transport: http("https://bsc-testnet-rpc.publicnode.com"),
});

async function main() {
  loadEnv();
  let pk = process.env.VIGIL_TESTNET_PRIVATE_KEY as string | undefined;
  if (!pk) {
    pk = generatePrivateKey();
    persistToEnv("VIGIL_TESTNET_PRIVATE_KEY", pk);
    logger.info("generated new testnet admin key (persisted to .env.testnet)");
  }

  const admin = signerFromPrivateKey(pk as `0x${string}`);
  const adminAddr = privateKeyToAccount(pk as `0x${string}`).address;
  const client = createClient({ chains: [BNB_TESTNET] });
  const wallet = await client.createWallet({ signer: admin });

  const adminBal = await publicClient.getBalance({ address: adminAddr });
  const walletBal = await publicClient.getBalance({ address: wallet.address });

  logger.info({
    admin: adminAddr,
    wallet: wallet.address,
    adminBal: adminBal.toString(),
    walletBal: walletBal.toString(),
    faucet: "https://testnet.bnbchain.org/faucet-smart",
  }, "TESTNET SETUP — fund the WALLET address above via the BNB testnet faucet, then re-run the spike");

  if (walletBal === 0n) {
    console.log("\nFund this address with test BNB (faucet):\n  " + wallet.address + "\n");
  }
}

main().catch((e) => {
  logger.error({ err: String(e) }, "setup failed");
  process.exit(1);
});
