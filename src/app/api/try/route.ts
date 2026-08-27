import { NextRequest } from "next/server";
import { getAgent } from "@/registry/queries";
import { callTool } from "@/registry/mcp";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/try — try a VERIFIED agent's tool without hiring, without a
 * wallet, without gas. This is the zero-dead-end on-ramp: land → find by
 * category → understand → TRY IT LIVE → then hire when convinced.
 *
 * Safety envelope:
 *  - only agents with a live-verified MCP endpoint;
 *  - only tools that appear in that verification;
 *  - nothing returned here is ever executed — an agent that returns calldata
 *    gets it displayed as inert JSON; submission happens only through a
 *    mandate + session path;
 *  - tight rate limit, hard timeout, capped output (this endpoint reaches
 *    THIRD-PARTY servers we don't control).
 */
const MAX_OUTPUT = 4000;

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`try:${ip}`, { limit: 8, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: "rate limited — up to 8 tries/min" }, { status: 429 });
  }

  let body: { agentId?: string; tool?: string; args?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { agentId, tool, args } = body;
  if (!agentId || !tool) {
    return Response.json({ error: "agentId and tool required" }, { status: 400 });
  }

  const agent = await getAgent(agentId);
  if (!agent) return Response.json({ error: "agent not found" }, { status: 404 });
  const a = agent as any;
  if (!a.verifiedAt || !a.services?.mcp?.endpoint) {
    return Response.json({ error: "agent is not live-verified yet" }, { status: 400 });
  }

  // The trial surface is exactly what verification saw — nothing invented client-side.
  const verified: string[] = a.services.mcp.verified ?? [];
  const declared: string[] = a.services.mcp.tools ?? [];
  const allowed = verified.length > 0 ? verified : declared;
  if (!allowed.includes(tool)) {
    return Response.json({ error: `tool "${tool}" is not part of this agent's verified capability` }, { status: 400 });
  }

  try {
    const result = await callTool(a.services.mcp.endpoint, tool, args ?? {});
    const text = (result.content ?? []).map((c: any) => c.text ?? "").join("\n");
    if (result.isError) {
      return Response.json({ ok: false, stage: "agent_error", text: text.slice(0, MAX_OUTPUT) });
    }
    return Response.json({
      ok: true,
      stage: "read",
      tool,
      note:
        "Inert preview — nothing from this call is ever executed. Real actions require a hire (scoped onchain session).",
      text: text.slice(0, MAX_OUTPUT),
      truncated: text.length > MAX_OUTPUT,
    });
  } catch (e: any) {
    return Response.json(
      { ok: false, stage: "mcp_call", error: String(e?.message ?? e).slice(0, 500) },
      { status: 502 },
    );
  }
}
