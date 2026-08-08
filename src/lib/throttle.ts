/**
 * Simple token-bucket throttle for external API rate limits.
 * 8004scan anonymous tier: 10 req/min (verified). The Pro tier (free for
 * hackathon) is 500 req/min — set RATE_LIMIT_PER_MIN env to raise it.
 */

const ANON_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN ?? 8); // headroom under 10

class Bucket {
  private tokens: number;
  private last: number;
  constructor(private ratePerMin: number) {
    this.tokens = ratePerMin;
    this.last = Date.now();
  }
  async take(): Promise<void> {
    const now = Date.now();
    this.tokens = Math.min(this.ratePerMin, this.tokens + ((now - this.last) / 60_000) * this.ratePerMin);
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = Math.ceil((60_000 / this.ratePerMin) * (1 - this.tokens));
    await new Promise((r) => setTimeout(r, waitMs));
    this.tokens = Math.max(0, this.tokens - 1);
  }
}

const buckets = new Map<string, Bucket>();
export function throttle(name: string): Bucket {
  let b = buckets.get(name);
  if (!b) {
    b = new Bucket(ANON_PER_MIN);
    buckets.set(name, b);
  }
  return b;
}
