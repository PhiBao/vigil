import { randomUUID } from "node:crypto";
import type { Address, Hex } from "viem";
import { callTool } from "../registry/mcp";
import type { AgentRecord } from "../registry/model";
import { validateCalldata, simulateCall } from "./validate-calldata";
import { store } from "../db";
import { decryptSecret } from "../lib/secrets";
import { Executor, sessionFromPersisted } from "../runtime/executor";
import type { MandateRecord } from "../db/store";
import { logger } from "../lib/logger";

/**
 * Hire execution. The user hires a THIRD-PARTY agent; we route the request to
 * the agent's MCP endpoint, receive its pre-validated calldata, validate it
 * against the user's mandate allowlist, simulate, and submit under the user's
 * Altana session. The agent proposes, the user's session decides.
 */

export interface HireOutcome {
  ok: boolean;
  mandateId?: string;
  agentName?: string;
  tool?: string;
  calldataRejected?: string;
  txHash?: string;
  receiptText?: string;
}

export async function hireAgent(
  agent: AgentRecord,
  tool: string,
  args: Record<string, unknown>,
  mandate: MandateRecord,
  opts: { confirm?: boolean } = { confirm: true },
): Promise<HireOutcome> {
  const ep = agent.services.mcp?.endpoint;
  if (!ep) throw new Error("agent has no MCP endpoint");

  // 1. Ask the agent to do the task.
  const result = await callTool(ep, tool, args);
  const text = (result.content ?? []).map((c) => c.text ?? "").join("\n");
  if (!text.trim()) return { ok: false, calldataRejected: "agent returned empty response" };

  // 2. The response should be calldata (target + data). Accept either a JSON
  //    object or a bare hex "0x…" data blob (target derived from tool context).
  let call: { to: Address; data: Hex; value?: bigint };
  try {
    const parsed = JSON.parse(text);
    if (!parsed.to || !parsed.data) throw new Error("missing to/data");
    call = { to: parsed.to as Address, data: parsed.data as Hex, value: parsed.value };
  } catch {
    // Fallback: if the text is a plain hex data blob, the target must be
    // supplied by the caller (e.g., the protocol contract for this tool).
    if (/^0x[a-fA-F0-9]+$/.test(text.trim())) {
      const to = args.__target as Address | undefined;
      if (!to) return { ok: false, calldataRejected: "agent returned bare calldata with no target" };
      call = { to, data: text.trim() as Hex };
    } else {
      return { ok: false, calldataRejected: "agent response was not calldata" };
    }
  }

  // 3. Validate against the mandate's permissions.
  const permissions = (mandate.permissions ?? {}) as { calls?: { to?: string }[] };
  const allowlist = (permissions.calls ?? []).map((c) => c.to).filter(Boolean) as Address[];
  const capUsdWei = BigInt(Math.round(Number(mandate.capUsd) * 1e18));
  const valid = validateCalldata(call, {
    allowlist,
    permittedSelectors: undefined, // allowlist + onchain enforcement are the backstop
    maxAmountWei: capUsdWei,
  });
  if (!valid.ok) {
    logger.warn({ agent: agent.name, reason: valid.reason }, "calldata rejected");
    return { ok: false, calldataRejected: valid.reason };
  }

  // 4. Simulate before sending.
  const simulated = await simulateCall(call);
  if (!simulated) return { ok: false, calldataRejected: "simulation reverted" };

  // 5. Submit under the user's session.
  const sessionKey = decryptSecret(mandate.sessionSignerEncrypted);
  const session = sessionFromPersisted(
    sessionKey,
    mandate.sessionPublicKey,
    permissions as any,
    mandate.expirySeconds,
    mandate.walletAddress as `0x${string}`,
  );
  const executor = new Executor();
  const res = await executor.execute(session, [call], opts);

  // 6. Receipt.
  await store().addReceipt({
    id: randomUUID(),
    mandateId: mandate.id,
    agentId: agent.agentId,
    event: "hire",
    detail: { tool, calldata: call.data.slice(0, 80), agent: agent.name },
    txHash: res.transactionHash,
    createdAt: new Date(),
  });

  return { ok: true, mandateId: mandate.id, agentName: agent.name, tool, txHash: res.transactionHash };
}
