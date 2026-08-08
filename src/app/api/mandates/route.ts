import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { store } from "../../../db";
import { encryptSecret } from "../../../lib/secrets";
import type { Category } from "../../../registry/model";

export const dynamic = "force-dynamic";

export interface CreateMandateBody {
  walletAddress: string;
  agentId: string;
  category: Category;
  capUsd: number;
  expirySeconds: number;
  sessionPublicKey: string;
  sessionSigner: string;
  permissions: {
    calls?: { to: string; signature?: string }[];
    spend?: { token?: string; limit: string; period: string }[];
  };
}

/** POST /api/mandates — persist a granted mandate (session stored encrypted). */
export async function POST(request: NextRequest) {
  let body: CreateMandateBody;
  try {
    body = (await request.json()) as CreateMandateBody;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { walletAddress, agentId, category, capUsd, expirySeconds, sessionPublicKey, sessionSigner } = body;
  if (!walletAddress || !agentId || !category || !sessionPublicKey || !sessionSigner) {
    return Response.json({ error: "missing fields" }, { status: 400 });
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return Response.json({ error: "invalid wallet address" }, { status: 400 });
  }
  // Validate the hired agent exists in our registry.
  const agent = await store().getAgent(agentId).catch(() => null);
  if (!agent) return Response.json({ error: "unknown agent" }, { status: 400 });
  if (!Number.isFinite(capUsd) || capUsd <= 0) return Response.json({ error: "invalid cap" }, { status: 400 });
  if (expirySeconds < Math.floor(Date.now() / 1000) + 60) return Response.json({ error: "expiry too soon" }, { status: 400 });

  try {
    await store().createMandate({
      id: randomUUID(),
      walletAddress,
      agentId,
      category,
      capUsd,
      expirySeconds,
      sessionPublicKey,
      sessionSignerEncrypted: encryptSecret(sessionSigner),
      permissions: body.permissions,
      status: "active",
      createdAt: new Date(),
    });
    return Response.json({ ok: true });
  } catch (e: any) {
    console.error("mandate create error", e);
    return Response.json({ error: "store unavailable", detail: String(e?.message ?? e) }, { status: 500 });
  }
}

/** GET /api/mandates?wallet=0x… — list active mandates for a wallet. */
export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet")?.trim()?.toLowerCase();
  if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) {
    return Response.json({ error: "invalid wallet" }, { status: 400 });
  }
  try {
    const rows = await store().listMandates(wallet);
    return Response.json({
      mandates: rows.map((m) => ({
        id: m.id,
        agentId: m.agentId,
        category: m.category,
        capUsd: m.capUsd,
        expirySeconds: m.expirySeconds,
        status: m.status,
        createdAt: m.createdAt,
      })),
    });
  } catch {
    return Response.json({ error: "store unavailable" }, { status: 500 });
  }
}
