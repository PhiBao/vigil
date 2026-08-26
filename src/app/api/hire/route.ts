import { NextRequest } from "next/server";
import { getAgent } from "@/registry/queries";
import { callTool } from "@/registry/mcp";
import { validateCalldata, simulateCall } from "@/hire/validate-calldata";
import { selectorsForCategory } from "@/mandate/permissions";
import type { Category } from "@/registry/model";
import { store } from "@/db";
import { decryptSecret, verifyRunToken } from "@/lib/secrets";
import { Executor, sessionFromPersisted, readAuthMeta, sdkPermissionsOf } from "@/runtime/executor";
import { rateLimit } from "@/lib/rate-limit";
import { toBaseUnits } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * POST /api/hire — call a hired agent's tool, validate its calldata,
 * and (if the tool returns calldata) execute under the mandate's session.
 * Read tools just return data; write tools go through the full validation +
 * session execution path. Rate-limited. Supports `dryRun: true` to validate
 * and simulate without submitting.
 *
 * Auth: mandates created after run tokens shipped require
 * `Authorization: Bearer <runToken>` (issued once at grant time). This is what
 * lets the user's own runner act unattended WITHOUT widening authority: every
 * call still faces calldata validation, the simulation gate, the spend caps
 * enforced by the onchain session, and one-click revocation.
 */
export async function POST(request: NextRequest) {
  // Rate limit per IP.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`hire:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "rate limited" }, { status: 429 });

  let body: { agentId: string; mandateId: string; tool: string; args?: Record<string, unknown>; dryRun?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { agentId, mandateId, tool, args, dryRun } = body;
  if (!agentId || !mandateId || !tool) return Response.json({ error: "agentId, mandateId, tool required" }, { status: 400 });

  const agent = (await getAgent(agentId)) as any;
  if (!agent) return Response.json({ error: "agent not found" }, { status: 404 });
  const ep = agent.services?.mcp?.endpoint;
  if (!ep) return Response.json({ error: "agent has no MCP endpoint" }, { status: 400 });

  const mandate = await store().getMandate(mandateId);
  if (!mandate) return Response.json({ error: "mandate not found" }, { status: 404 });
  if (mandate.agentId !== agentId) return Response.json({ error: "mandate does not belong to this agent" }, { status: 403 });
  if (mandate.status !== "active") return Response.json({ error: `mandate is ${mandate.status}` }, { status: 400 });
  if (mandate.expirySeconds * 1000 < Date.now()) return Response.json({ error: "mandate expired" }, { status: 400 });

  // Run-token check for post-token mandates.
  const auth = readAuthMeta(mandate.permissions);
  if (auth) {
    const bearer = request.headers.get("authorization");
    const token = bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : undefined;
    if (!verifyRunToken(token, auth.sha256)) {
      return Response.json(
        { error: "unauthorized: missing or invalid run token (Authorization: Bearer <runToken>)" },
        { status: 401 },
      );
    }
  }

  // 1) Call the agent.
  let mcpResult: any;
  try {
    mcpResult = await callTool(ep, tool, args ?? {});
  } catch (e: any) {
    return Response.json({ ok: false, stage: "mcp_call", error: String(e?.message ?? e).slice(0, 600) }, { status: 502 });
  }
  const text = (mcpResult.content ?? []).map((c: any) => c.text ?? "").join("\n");
  if (mcpResult.isError) {
    return Response.json({ ok: false, stage: "agent_error", text: text.slice(0, 2000) });
  }

  // Heuristic: does the response look like calldata? If not, it's a read tool — return data.
  const looksCalldata = (() => {
    try {
      const p = JSON.parse(text);
      return Boolean(p.to && p.data && /^0x[a-fA-F0-9]+$/.test(p.data));
    } catch {
      return false;
    }
  })();

  if (!looksCalldata) {
    // Read tool — just return the data, no session execution.
    return Response.json({ ok: true, stage: "read", text: text.slice(0, 8000) });
  }

  // 2) Validate calldata against the persisted mandate (single source of authority).
  const parsed = JSON.parse(text);
  let callValue: bigint | undefined;
  if (parsed.value !== undefined && parsed.value !== null && parsed.value !== "") {
    try {
      callValue = BigInt(parsed.value);
    } catch {
      return Response.json({ ok: false, stage: "validation", error: "invalid value field", text: text.slice(0, 2000) }, { status: 400 });
    }
  }
  const call = { to: parsed.to as `0x${string}`, data: parsed.data as `0x${string}`, value: callValue };
  // Allowlist comes from the persisted mandate, not the live category table.
  const persistedCalls = ((mandate.permissions ?? {}) as { calls?: { to?: string }[] }).calls ?? [];
  const allow = persistedCalls.map((c) => c.to).filter(Boolean) as `0x${string}`[];
  const capWei = toBaseUnits(Number(mandate.capUsd));
  const permittedSelectors = selectorsForCategory((mandate.category ?? "yield") as Category);
  const valid = validateCalldata(call, {
    allowlist: allow,
    permittedSelectors,
    allowedApproveSpenders: allow as any,
    maxAmountWei: capWei,
    maxValueWei: capWei,
  });
  if (!valid.ok) {
    return Response.json({ ok: false, stage: "validation", error: valid.reason, text: text.slice(0, 2000) }, { status: 400 });
  }

  // 3) Simulate as the wallet.
  const simOk = await simulateCall(call, mandate.walletAddress as `0x${string}`);
  if (!simOk) {
    return Response.json({ ok: false, stage: "simulation", error: "simulation reverted", text: text.slice(0, 2000) }, { status: 400 });
  }
  if (dryRun) {
    return Response.json({ ok: true, stage: "simulated", text: text.slice(0, 4000), validated: valid.decoded });
  }

  // 4) Execute under the mandate's session.
  const sessionKey = decryptSecret(mandate.sessionSignerEncrypted);
  const session = sessionFromPersisted(
    sessionKey,
    mandate.sessionPublicKey,
    sdkPermissionsOf(mandate.permissions),
    mandate.expirySeconds,
    mandate.walletAddress as `0x${string}`,
  );
  const executor = new Executor();
  let exec: any;
  try {
    exec = await executor.execute(session, [call]);
  } catch (e: any) {
    return Response.json({ ok: false, stage: "execution", error: String(e?.message ?? e).slice(0, 600) }, { status: 500 });
  }

  // 5) Receipt.
  const { randomUUID } = await import("node:crypto");
  await store().addReceipt({
    id: randomUUID(),
    mandateId: mandate.id,
    agentId: agent.agentId,
    event: "hire_execute",
    detail: { tool, calldata: call.data.slice(0, 120), agent: agent.name },
    txHash: exec.transactionHash,
    createdAt: new Date(),
  });

  return Response.json({ ok: true, stage: "executed", txHash: exec.transactionHash, text: text.slice(0, 4000) });
}
