import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { store } from "../../../db";
import { encryptSecret } from "../../../lib/secrets";
import { rateLimit } from "../../../lib/rate-limit";
import type { Category } from "../../../registry/model";
import { toBaseUnits } from "../../../lib/money";
import { buildPermissions } from "../../../mandate/permissions";

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
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`mandate:${ip}`, { limit: 20, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "rate limited" }, { status: 429 });
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
  try {
    toBaseUnits(capUsd);
  } catch (e: any) {
    return Response.json({ error: "invalid cap", detail: String(e?.message ?? e) }, { status: 400 });
  }
  if (expirySeconds < Math.floor(Date.now() / 1000) + 60) return Response.json({ error: "expiry too soon" }, { status: 400 });

  // Verify client-supplied permissions match the canonical buildPermissions for this
  // category/cap/expiry. We allow the client to be more restrictive but not broader.
  if (body.permissions) {
    try {
      const canonical = buildPermissions(category, {
        capUsd,
        expirySeconds,
        walletAddress: walletAddress as `0x${string}`,
      });
      const canonCalls = new Set((canonical.calls ?? []).map((c: any) => (c.to as string).toLowerCase()));
      const clientCalls = (body.permissions.calls ?? []).map((c) => c.to.toLowerCase());
      for (const c of clientCalls) {
        if (!canonCalls.has(c)) {
          return Response.json({ error: `permission call ${c} not in canonical allowlist for ${category}` }, { status: 400 });
        }
      }
      // Spend limits must not exceed canonical (fail if client inflates caps).
      const canonSpend = new Map<string, bigint>();
      for (const s of (canonical.spend ?? []) as any[]) {
        const key = s.token ? (s.token as string).toLowerCase() : "__native__";
        canonSpend.set(key, s.limit as bigint);
      }
      for (const s of body.permissions.spend ?? []) {
        const key = s.token ? s.token.toLowerCase() : "__native__";
        const canonLimit = canonSpend.get(key);
        if (canonLimit === undefined) {
          return Response.json({ error: `spend token ${s.token ?? "native"} not in canonical permissions` }, { status: 400 });
        }
        if (BigInt(s.limit) > canonLimit) {
          return Response.json({ error: `spend limit for ${s.token ?? "native"} exceeds canonical cap` }, { status: 400 });
        }
      }
    } catch (e: any) {
      // buildPermissions can throw on invariant violation or toBaseUnits failure.
      return Response.json({ error: "invalid permissions", detail: String(e?.message ?? e) }, { status: 400 });
    }
  }

  try {
    const id = randomUUID();
    await store().createMandate({
      id,
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
    return Response.json({ ok: true, id });
  } catch (e: any) {
    console.error("mandate create error", e);
    return Response.json({ error: "store unavailable", detail: String(e?.message ?? e) }, { status: 500 });
  }
}

/** GET /api/mandates?wallet=0x… — list active mandates for a wallet. */
export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`mandates:${ip}`, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "rate limited" }, { status: 429 });
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
