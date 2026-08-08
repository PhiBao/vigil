import { NextRequest } from "next/server";
import { isAddress } from "viem";
import { scanAddress } from "../../../scanner";
import { diagnose } from "../../../diagnose";
import { agentsForCategory } from "../../../registry/queries";
import type { Category } from "../../../registry/model";
import { rateLimit } from "../../../lib/rate-limit";

export const dynamic = "force-dynamic";

/** Finding category -> registry category. */
const FINDING_TO_CATEGORY: Record<string, Category> = {
  health_factor: "health_factor",
  lp_range: "rebalancing",
  idle_yield: "yield",
};

function agentView(a: any) {
  return {
    id: a.agentId,
    name: a.name,
    tagline: a.description.slice(0, 180),
    category: a.categories,
    verified: Boolean(a.verifiedAt),
    healthStatus: a.healthStatus,
    x402: Boolean(a.x402),
    hireable: Boolean(a.x402 && a.services?.mcp && a.verifiedAt),
    freshness: a.verifiedAt,
    uptimeOk: a.uptimeOk,
    uptimeChecks: a.uptimeChecks,
  };
}

/** GET /api/scan?address=0x… → scan + diagnosis + matching registry agents. */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim() ?? "";

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`scan:${ip}`, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } });
  }

  if (!address) return Response.json({ error: "address required" }, { status: 400 });
  if (!isAddress(address)) return Response.json({ error: "invalid address" }, { status: 400 });

  try {
    const scan = await scanAddress(address);
    const diag = await diagnose(scan);

    const findings = [];
    for (const f of diag.findings) {
      const cat = FINDING_TO_CATEGORY[f.category];
      const agents = cat ? await agentsForCategory(cat) : [];
      findings.push({
        id: f.id,
        category: f.category,
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        dollarsAtRisk: f.dollarsAtRisk,
        opportunityPerYear: f.opportunityPerYear,
        agents: agents.slice(0, 4).map(agentView),
      });
    }

    return Response.json({
      address,
      at: scan.at,
      healthy: diag.healthy,
      findings,
      totalAtRisk: diag.totalAtRisk,
      totalOpportunityPerYear: diag.totalOpportunityPerYear,
      checked: diag.checked,
      hasPositions: scan.hasPositions,
      summary: {
        venusBorrowUsd: scan.venus?.totalBorrowUsd ?? 0,
        venusHealthFactor: scan.venus?.healthFactor ?? null,
        aaveDebtUsd: scan.aave?.totalDebtUsd ?? 0,
        v3OutOfRangeUsd: scan.v3?.outOfRangeUsd ?? 0,
        idleUsd: scan.idleStables.reduce((s, x) => s + x.usd, 0),
      },
    });
  } catch (e: any) {
    console.error("scan route error", e);
    return Response.json({ error: "scan failed", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
