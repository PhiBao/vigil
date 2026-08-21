import { NextRequest } from "next/server";
import { getAgent } from "@/registry/queries";
import { listTools } from "@/registry/mcp";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/agent/[agentId]/tools — live tool schemas for the hire UI. Cached via verify cache. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`tools:${ip}`, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "rate limited" }, { status: 429 });
  const { agentId } = await params;
  const id = decodeURIComponent(agentId);
  const agent = await getAgent(id);
  if (!agent) return Response.json({ error: "agent not found" }, { status: 404 });
  const ep = (agent as any).services?.mcp?.endpoint;
  if (!ep) return Response.json({ tools: [], note: "no MCP endpoint" });

  try {
    const tools = await listTools(ep);
    return Response.json({ tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
  } catch (e: any) {
    // Fall back to stored verified names if live probe fails (rate limit etc.)
    const verified = (agent as any).services?.mcp?.verified ?? (agent as any).services?.mcp?.tools ?? [];
    return Response.json({ tools: verified.map((n: string) => ({ name: n })), live: false, error: String(e?.message ?? e).slice(0, 200) });
  }
}
