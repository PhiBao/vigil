import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * Encrypt session signers at rest (AES-256-GCM). The key derives from
 * MANDATE_ENCRYPTION_KEY (or falls back to a dev-only value with a loud
 * warning). Never store agent session keys in plaintext.
 */

function keyMaterial(): Buffer {
  const secret = process.env.MANDATE_ENCRYPTION_KEY;
  if (!secret) {
    console.warn(
      "WARNING: MANDATE_ENCRYPTION_KEY not set — using insecure dev key. Set it in production.",
    );
  }
  return createHash("sha256").update(secret ?? "dev-only-insecure-key").digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed secret payload");
  const decipher = createDecipheriv("aes-256-gcm", keyMaterial(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Mandate RUN TOKENS — the autonomy credential.
 *
 * After hiring, the user can let their own runner (cron job, CLI loop, LLM
 * operator) call Vigil's execute API unattended. The credential is a random
 * 256-bit bearer token shown ONCE at grant time; we keep only its SHA-256.
 * It authorizes calls that are still bounded by everything else: the agent's
 * calldata validation, the spend caps in the onchain session, and revocation.
 * Losing the token is recoverable — revoke the mandate and hire again.
 */

/** Generate a fresh run token (returned to the user exactly once). */
export function newRunToken(): string {
  return randomBytes(32).toString("hex");
}

/** SHA-256 of a presented token, hex — what we store, never the token itself. */
export function hashRunToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison of a presented token against a stored hash. */
export function verifyRunToken(presented: string | undefined | null, storedHash: string): boolean {
  if (!presented) return false;
  const got = Buffer.from(hashRunToken(presented), "hex");
  const want = Buffer.from(storedHash, "hex");
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

