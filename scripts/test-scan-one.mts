import { scanAddress } from "../src/scanner";
import { logger } from "../src/lib/logger";

async function main(){
  const addr = process.argv[2] as `0x${string}`;
  const t0 = Date.now();
  const scan = await scanAddress(addr);
  logger.info({ ms: Date.now()-t0, venus: !!scan.venus, aave: !!scan.aave, v3: !!scan.v3, idle: scan.idleStables.length }, "one scan done");
}
main().catch(e=>{logger.error({err:String(e)},"fail");process.exit(1)});
