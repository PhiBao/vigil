import { NextRequest } from "next/server";
import { store } from "../../../../../db";

export const dynamic = "force-dynamic";

/**
 * POST /api/mandates/[id]/revoke
 * Two-step flow: the onchain revoke needs the user's passkey (admin key), so
 * the client calls this once to fetch the session public key + mark pending,
 * does the browser-side revokeSession, then calls again with confirmed=true.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { walletAddress?: string; confirmed?: boolean };
  try {
    body = (await request.json()) as { walletAddress?: string; confirmed?: boolean };
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  try {
    const s = store();
    const m = await s.getMandate(id);
    if (!m) return Response.json({ error: "mandate not found" }, { status: 404 });
    if (body.walletAddress && body.walletAddress.toLowerCase() !== m.walletAddress.toLowerCase()) {
      return Response.json({ error: "wallet mismatch" }, { status: 403 });
    }

    if (!body.confirmed) {
      return Response.json({ needSigner: true, sessionPublicKey: m.sessionPublicKey });
    }

    await s.setMandateStatus(id, "revoked", new Date());
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: "store unavailable", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
