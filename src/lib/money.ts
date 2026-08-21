/**
 * Typed money handling for BSC.
 *
 * Verified during discovery: USDT and USDC are 18-decimal BEP-20 on BNB Chain,
 * NOT the 6 decimals they use on Ethereum. Altana's own docs warn that writing
 * 100_000_000n for "100 USDT" on BSC silently sets a cap of 0.0000000001 USDT.
 *
 * This module is the single place token amounts are converted. Never hardcode
 * decimals in call sites.
 */

export const BSC_TOKEN_DECIMALS = 18n;

export function toBaseUnits(amount: number, decimals: bigint = BSC_TOKEN_DECIMALS): bigint {
  if (!Number.isFinite(amount)) throw new Error(`invalid amount: ${String(amount)}`);
  if (amount < 0) throw new Error(`negative amount: ${amount}`);
  if (amount >= 1e21) throw new Error(`amount too large for fixed-point conversion: ${amount}`);
  // Use decimal string parsing to avoid binary float drift (e.g. 8.7*1e18 off by 1e3).
  // toFixed on 0.1 yields "0.100000000000000006" (binary artefact), so prefer toString.
  let s = amount.toString();
  if (s.includes("e") || s.includes("E")) {
    // Handles 1e-7 etc. Fall back to fixed-point then re-check.
    s = amount.toFixed(Number(decimals));
    if (s.includes("e") || s.includes("E")) throw new Error(`amount produced exponential notation: ${amount} -> ${s}`);
  }
  const [intPart, fracPart = ""] = s.split(".");
  const padded = (fracPart + "0".repeat(Number(decimals))).slice(0, Number(decimals));
  const intDigits = intPart.replace(/[^0-9]/g, "") || "0";
  return BigInt(intDigits) * 10n ** decimals + BigInt(padded || "0");
}

export function fromBaseUnits(
  units: bigint | string,
  decimals: bigint = BSC_TOKEN_DECIMALS,
): number {
  const u = BigInt(units);
  const neg = u < 0n;
  const abs = neg ? -u : u;
  const s = abs.toString().padStart(Number(decimals) + 1, "0");
  const int = s.slice(0, -Number(decimals)) || "0";
  const frac = s.slice(-Number(decimals)).replace(/0+$/, "");
  const out = `${int}${frac ? "." + frac : ""}`;
  return Number(neg ? "-" + out : out);
}

/** Format a base-unit amount as a human string with $ prefix. */
export function usd(units: bigint | string, decimals: bigint = BSC_TOKEN_DECIMALS): string {
  return "$" + fromBaseUnits(units, decimals).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
