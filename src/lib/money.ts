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
  // Round-trip through string to avoid float drift; amounts are human inputs.
  const s = amount.toFixed(Number(decimals));
  const [int, frac = ""] = s.split(".");
  const padded = (frac + "0".repeat(Number(decimals))).slice(0, Number(decimals));
  return BigInt(int.replace(/[^0-9]/g, "") || "0") * 10n ** decimals + BigInt(padded || "0");
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
