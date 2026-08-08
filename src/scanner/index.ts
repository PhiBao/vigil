import type { Address } from "viem";
import { getVenusSnapshot, type VenusSnapshot } from "./venus";
import { getAaveSnapshot, type AaveSnapshot } from "./aave";
import { getV3Snapshot, type V3Snapshot } from "./pancake-v3";
import { getIdleStables, type IdleStable } from "./balances";
import { logger } from "../lib/logger";

/**
 * Full position scan for one address. Read-only, no wallet connection.
 * All four judged categories map to these reads.
 */
export interface ScanResult {
  address: Address;
  at: string;
  venus: VenusSnapshot | null;
  aave: AaveSnapshot | null;
  v3: V3Snapshot | null;
  idleStables: IdleStable[];
  /** USD deployed in Venus/Aave by stable symbol, used to subtract from idle. */
  deployedStables: Record<string, number>;
  /** True if the address has any detected activity at all. */
  hasPositions: boolean;
}

export async function scanAddress(address: Address): Promise<ScanResult> {
  const started = Date.now();

  const [venus, aave, v3, idleStables] = await Promise.all([
    getVenusSnapshot(address),
    getAaveSnapshot(address),
    getV3Snapshot(address),
    getIdleStables(address),
  ]);

  // Subtract stable amounts already deployed in Venus (USD) from idle detection,
  // so "idle" means genuinely idle. Aave position reads give token units, so we
  // conservatively subtract nothing there — idle detection stays a lower bound.
  const deployedStables: Record<string, number> = {};
  for (const p of venus?.positions ?? []) {
    const symbol = p.symbol.replace("v", "");
    deployedStables[symbol] = (deployedStables[symbol] ?? 0) + p.suppliedUsd;
  }

  const hasPositions =
    (venus !== null && venus.positions.length > 0) ||
    (aave !== null && (aave.totalCollateralUsd > 0 || aave.totalDebtUsd > 0)) ||
    (v3 !== null && v3.positions.length > 0) ||
    idleStables.length > 0;

  const result: ScanResult = {
    address,
    at: new Date().toISOString(),
    venus,
    aave,
    v3,
    idleStables,
    deployedStables,
    hasPositions,
  };

  logger.info(
    { address, ms: Date.now() - started, venus: !!venus, aave: !!aave, v3: !!v3, stables: idleStables.length },
    "scan complete",
  );

  return result;
}
