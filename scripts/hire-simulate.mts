/**
 * Vertical slice (part 2): hire execution path, SIMULATED.
 * Calls the real third-party agent's MCP endpoint, receives its calldata,
 * validates it against the mandate allowlist, and simulates it — no funds moved.
 * Run: pnpm tsx scripts/hire-simulate.mts [toolName] [wallet]
 */
import { loadEnv } from "../src/lib/env";
import { store } from "../src/db";
import { callTool } from "../src/registry/mcp";
import { validateCalldata, simulateCall } from "../src/hire/validate-calldata";
import { allowlistForCategory } from "../src/mandate/permissions";
import { logger } from "../src/lib/logger";

const WALLET = (process.argv[3] ?? "0xda977767452c5dd021624511f14df67b6c9c2c1b") as `0x${string}`;

async function main() {
  loadEnv();
  const toolName = process.argv[2] ?? "getBorrowBalance";

  const agents = (await store().listAgents()) as any[];
  const venus = agents.find((a) => (a.name ?? "").includes("Venus powered by HeyAnon"));
  if (!venus || !venus.services?.mcp?.endpoint) throw new Error("Venus agent not indexed");

  logger.info({ agent: venus.name, endpoint: venus.services.mcp.endpoint, tool: toolName }, "hiring agent");

  // 1. Call the real MCP tool.
  const args: Record<string, unknown> = toolName.startsWith("get")
    ? { userAddress: WALLET, chainName: "bsc", pool: "CORE", tokenSymbols: ["USDT"] }
    : { userAddress: WALLET, tokenSymbol: "USDT", chainName: "bsc", pool: "CORE", amount: "1" };
  const result = await callTool(venus.services.mcp.endpoint, toolName, args);
  const text = (result.content ?? []).map((c: any) => c.text ?? "").join("\n");
  logger.info({ isError: result.isError, text: text.slice(0, 400) }, "agent response");

  // 2. If it looks like calldata, validate it.
  const allow = allowlistForCategory("health_factor");
  const looksLikeCalldata = text.includes('"to"') || text.includes('"data"') || /^0x[a-fA-F0-9]{8,}/.test(text.trim());
  if (looksLikeCalldata) {
    try {
      const parsed = JSON.parse(text);
      const valid = validateCalldata(
        { to: parsed.to, data: parsed.data },
        { allowlist: allow, maxAmountWei: 100n * 10n ** 18n },
      );
      logger.info({ valid: valid.ok, reason: valid.reason ?? "ok" }, "calldata validation");
      if (valid.ok) {
        const sim = await simulateCall({ to: parsed.to, data: parsed.data });
        logger.info({ sim }, "simulation (no funds moved)");
      }
    } catch (e: any) {
      logger.warn({ err: String(e?.message ?? e) }, "response was not structured calldata");
    }
  } else {
    logger.info("tool returned data (read), not calldata — expected for read tools");
  }
}

main().catch((e) => {
  logger.error({ err: String(e?.message ?? e) }, "hire simulate failed");
  process.exit(1);
});
