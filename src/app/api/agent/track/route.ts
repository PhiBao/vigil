import { NextRequest } from "next/server";
import { store } from "../../../../db";

export const dynamic = "force-dynamic";

/** GET /api/agent/track?agent=… — proving-ground track record (public). */
export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agent") ?? undefined;
  try {
    const runs = await store().listRuns(agentId);
    const byAgent: Record<
      string,
      { runs: number; ok: number; miss: number; tasks: { task: string; at: string; txHashes: string[] }[] }
    > = {};
    for (const r of runs) {
      byAgent[r.agentId] ??= { runs: 0, ok: 0, miss: 0, tasks: [] };
      const a = byAgent[r.agentId];
      a.runs++;
      if (r.status === "ok") a.ok++;
      if (r.status === "miss") a.miss++;
      a.tasks.push({ task: r.task, at: r.startedAt.toISOString(), txHashes: r.txHashes });
    }
    return Response.json({ byAgent });
  } catch {
    return Response.json({ error: "store unavailable" }, { status: 500 });
  }
}
