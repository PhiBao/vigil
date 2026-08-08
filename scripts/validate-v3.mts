import { publicClient } from "../src/lib/rpc";
import { pcsV3NpmAbi, pcsV3FactoryAbi, pcsV3PoolAbi } from "../src/scanner/abis";
import { ADDRESSES } from "../src/config";
import { v3Amounts, sqrtX96ToNumber } from "../src/scanner/pancake-v3";
import { logger } from "../src/lib/logger";

const TICK_BASE = 1.0001;

async function main() {
  const totalSupply = Number(await publicClient.readContract({ address: ADDRESSES.pancakeV3NPM, abi: pcsV3NpmAbi, functionName: "totalSupply" }));
  logger.info({ totalSupply }, "NPM totalSupply");
  // Global mint counter exceeds totalSupply due to burns; probe from a high id.
  const probe = totalSupply * 2 + 500000;
  let found = 0;
  for (let i = probe; i > probe - 400 && found < 5; i--) {
    const id = BigInt(i);
    let p: any;
    try { p = await publicClient.readContract({ address: ADDRESSES.pancakeV3NPM, abi: pcsV3NpmAbi, functionName: "positions", args: [id] }); }
    catch { continue; }
    const [, , token0, token1, fee, tickLower, tickUpper, liquidity] = p;
    if (liquidity === 0n) continue;
    found++;
    const pool = await publicClient.readContract({ address: ADDRESSES.pancakeV3Factory, abi: pcsV3FactoryAbi, functionName: "getPool", args: [token0, token1, fee] }) as `0x${string}`;
    if (pool === "0x0000000000000000000000000000000000000000") continue;
    const slot0 = await publicClient.readContract({ address: pool, abi: pcsV3PoolAbi, functionName: "slot0" }) as [bigint, number, number, number, number, number, boolean];
    const sqrtCur = sqrtX96ToNumber(slot0[0]);
    const price = sqrtCur * sqrtCur;
    const lowerP = Math.pow(TICK_BASE, tickLower);
    const upperP = Math.pow(TICK_BASE, tickUpper);
    const inRange = price >= lowerP && price <= upperP;
    const amts = v3Amounts(liquidity, sqrtCur, Math.sqrt(lowerP), Math.sqrt(upperP));
    logger.info({
      id: id.toString(), fee,
      tickRange: `${tickLower}..${tickUpper}`, tick: slot0[1],
      inRange,
      amt0: amts.amount0.toPrecision(3), amt1: amts.amount1.toPrecision(3),
      valid: amts.amount0 >= 0 && amts.amount1 >= 0,
    }, "V3 live position");
  }
  logger.info({ found }, "done");
}
main().catch((e) => { logger.error({ err: String(e) }, "fail"); process.exit(1); });
