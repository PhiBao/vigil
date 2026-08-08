/**
 * Dev test: run the full scan + diagnose against candidate addresses.
 * Run: pnpm tsx scripts/test-scan.mts <address> [more addresses...]
 */
import { isAddress } from "viem";
import { scanAddress } from "../src/scanner";
import { diagnose } from "../src/diagnose";
import { loadEnv } from "../src/lib/env";
import { logger } from "../src/lib/logger";

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const candidates = args.length > 0 ? args : [
    // Binance hot wallets
    "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3",
    "0xF977814e90dA44bFA03b6295A0616a897441aceC",
    // 8004scan agent owners
    "0x0d68a153897b73a6e4d2eaa9b0d4802bae69532d",
    "0x88dda819068eaae0230155f43ffcef70318537ab",
    "0x75b583c518215e272f3c0a3bcc1b27012f294adc",
    // zero address (sanity)
    "0x0000000000000000000000000000000000000000",
  ];

  for (const addr of candidates) {
    if (!isAddress(addr)) {
      logger.warn({ addr }, "invalid address, skipping");
      continue;
    }
    try {
      const scan = await scanAddress(addr);
      const diag = await diagnose(scan);
      logger.info(
        {
          addr,
          hasPositions: scan.hasPositions,
          venus: scan.venus
            ? {
                borrowUsd: Math.round(scan.venus.totalBorrowUsd),
                hf: scan.venus.healthFactor === Infinity ? "inf" : scan.venus.healthFactor.toFixed(2),
              }
            : null,
          aave: scan.aave
            ? {
                debtUsd: Math.round(scan.aave.totalDebtUsd),
                hf: scan.aave.healthFactor === Infinity ? "inf" : scan.aave.healthFactor.toFixed(2),
              }
            : null,
          v3Positions: scan.v3?.positions.length ?? 0,
          idle: scan.idleStables.map((s) => `${s.symbol}:${Math.round(s.usd)}`),
          findings: diag.findings.map((f) => `${f.severity}:${f.category}`),
        },
        "SCAN RESULT",
      );
    } catch (e: any) {
      logger.error({ addr, err: String(e?.message ?? e) }, "scan error");
    }
  }
}

main().catch((e) => {
  logger.error({ err: String(e) }, "test failed");
  process.exit(1);
});
