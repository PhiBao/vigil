/**
 * Minimal in-memory rate limiter (token bucket per key). Protects public
 * endpoints during judging without external infra. Not a substitute for a
 * production limiter, but sufficient for a hackathon build.
 */

const buckets = new Map<string, { tokens: number; last: number }>();

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: opts.limit, last: now };
    buckets.set(key, b);
  }
  // refill over the window
  const refill = ((now - b.last) / opts.windowMs) * opts.limit;
  b.tokens = Math.min(opts.limit, b.tokens + refill);
  b.last = now;

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { ok: true, retryAfterMs: 0 };
  }
  const retryAfterMs = Math.max(0, opts.windowMs - (now - b.last));
  return { ok: false, retryAfterMs };
}
