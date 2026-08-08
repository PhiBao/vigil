import { NextRequest } from "next/server";
import { store } from "../../../db";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent?op=stats — registry maintenance status (public counts).
 * GET /api/agent?op=verify — trigger verification of unverified agents
 *   (protected by AGENT_RUN_KEY). Exposed so the build can be watched.
 */
export async function GET(request: NextRequest) {
  const op = request.nextUrl.searchParams.get("op") ?? "stats";

  if (op === "stats") {
    const s = store();
    const agents = (await s.listAgents()) as any[];
    const byCat: Record<string, number> = {};
    for (const a of agents) for (const c of a.categories ?? []) byCat[c] = (byCat[c] ?? 0) + 1;
    const hireable = agents.filter((a) => a.x402 && a.services?.mcp && a.verifiedAt).length;
    return Response.json({
      totalIndexed: agents.length,
      hireable,
      byCategory: byCat,
      lastUpdated: new Date().toISOString(),
    });
  }

  if (op === "verify") {
    const key = request.nextUrl.searchParams.get("key");
    if (!process.env.AGENT_RUN_KEY || key !== process.env.AGENT_RUN_KEY) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    // Trigger verification in-process (bounded).
    const { verifyAgents } = await import("../../../registry/verify-run");
    const res = await verifyAgents({ limit: 10 });
    return Response.json(res);
  }

  return Response.json({ error: "unknown op" }, { status: 400 });
}
