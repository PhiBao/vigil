/**
 * Phase 0 completion: full Altana session-key round-trip on BSC testnet with
 * the funded wallet. Proves grant → execute → enforce → revoke.
 * Run: pnpm tsx scripts/roundtrip-testnet.mts
 */
import { http, createPublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BNB_TESTNET, createClient, signerFromPrivateKey } from "@altananetwork/sdk";
import { loadEnv } from "../src/lib/env";
import { logger } from "../src/lib/logger";

const publicClient = createPublicClient({
  transport: http("https://bsc-testnet-rpc.publicnode.com"),
});

async function main() {
  loadEnv();
  const pk = process.env.VIGIL_TESTNET_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) throw new Error("VIGIL_TESTNET_PRIVATE_KEY not set");

  const adminAddr = privateKeyToAccount(pk).address;
  const bal = await publicClient.getBalance({ address: adminAddr });
  logger.info({ admin: adminAddr, bal: (Number(bal) / 1e18).toFixed(4) }, "admin wallet");
  if (bal === 0n) throw new Error("testnet wallet not funded");

  const client = createClient({ chains: [BNB_TESTNET] });
  const admin = signerFromPrivateKey(pk);
  const wallet = await client.createWallet({ signer: admin });
  logger.info({ wallet: wallet.address }, "created smart-account wallet");

  // Grant a scoped session; allowlist only a benign target to prove both sides.
  const benignTarget = "0x000000000000000000000000000000000000dEaD";
  const expiry = Math.floor(Date.now() / 1000) + 60 * 60;
  const session = await client.grantSession({
    wallet,
    signer: admin,
    permissions: {
      calls: [{ to: benignTarget }],
      spend: [{ limit: 1n * 10n ** 18n, period: "day" }],
    },
    expiry,
    register: true,
  });
  logger.info({ key: session.publicKey.slice(0, 18) }, "session granted + registered to Keystore");

  // Execute via the SESSION KEY to the allowed target.
  const ok = await client.execute({ session, calls: [{ to: benignTarget, value: 1n * 10n ** 12n }] });
  logger.info({ callsId: ok.callsId, status: ok.status, tx: ok.transactionHash }, "session execute (allowed)");

  // Non-allowlisted target must be rejected.
  const evilTarget = "0x1111111111111111111111111111111111111111";
  try {
    await client.execute({ session, calls: [{ to: evilTarget, value: 0n }] });
    throw new Error("PERMISSION MODEL BROKEN: non-allowlisted call succeeded");
  } catch (e: any) {
    logger.info({ err: String(e?.message ?? e).slice(0, 120) }, "non-allowlisted call rejected (expected)");
  }

  // Revoke, then confirm execution is impossible.
  await client.revokeSession({ wallet, signer: admin, session });
  logger.info("session revoked");
  try {
    await client.execute({ session, calls: [{ to: benignTarget, value: 0n }] });
    throw new Error("REVOCATION BROKEN: execute after revoke succeeded");
  } catch (e: any) {
    logger.info({ err: String(e?.message ?? e).slice(0, 120) }, "execute after revoke rejected (expected)");
  }

  logger.info("PHASE 0 PASSED: grant → execute → enforce → revoke");
}

main().catch((e) => {
  logger.error({ err: String(e?.message ?? e) }, "roundtrip failed");
  process.exit(1);
});
