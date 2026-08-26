/**
 * Token-bucket throttle for external API rate limits, with a hard daily budget.
 *
 * MEASURED (not assumed) 8004scan anonymous-tier limits, read from the response
 * headers of a live GET /api/v1/public/agents:
 *
 *   x-ratelimit-limit-minute: 180     x-ratelimit-remaining-minute: 179
 *   x-ratelimit-limit-day:    20000   x-ratelimit-remaining-day:    19999
 *
 * A previous version of this file assumed 10/min and ran at 8/min. That was
 * wrong by 22x and was the single reason the index stayed small: a full pass
 * over the 5,086 MCP records would have taken ~10h instead of ~30min.
 *
 * `observe()` re-tunes the bucket from real response headers, so if the tier
 * changes we follow it instead of trusting this comment.
 */

/** Headroom factor — never spend the last slice of the published limit. */
const HEADROOM = 0.85;
const DEFAULT_PER_MIN = 180;
const DEFAULT_PER_DAY = 20_000;

export class Bucket {
  private tokens: number;
  private last: number;
  private ratePerMin: number;
  /** Requests spent in the current UTC day, against `perDay`. */
  private daySpent = 0;
  private dayKey: string;
  private perDay: number;

  constructor(ratePerMin: number, perDay: number) {
    this.ratePerMin = ratePerMin;
    this.perDay = perDay;
    this.tokens = ratePerMin;
    this.last = Date.now();
    this.dayKey = new Date().toISOString().slice(0, 10);
  }

  /** Effective per-minute rate after headroom. */
  get rate(): number {
    return Math.max(1, Math.floor(this.ratePerMin * HEADROOM));
  }

  get remainingToday(): number {
    this.rollDay();
    return Math.max(0, this.perDay - this.daySpent);
  }

  private rollDay() {
    const k = new Date().toISOString().slice(0, 10);
    if (k !== this.dayKey) {
      this.dayKey = k;
      this.daySpent = 0;
    }
  }

  /**
   * Re-tune from live response headers. Cheap to call on every response.
   * Only ever lowers the daily budget to what the server reports remaining,
   * so a shared/quota-partially-used key cannot be overrun.
   */
  observe(headers: Headers): void {
    const perMin = Number(headers.get("x-ratelimit-limit-minute"));
    if (Number.isFinite(perMin) && perMin > 0 && perMin !== this.ratePerMin) {
      this.ratePerMin = perMin;
      this.tokens = Math.min(this.tokens, perMin);
    }
    const perDay = Number(headers.get("x-ratelimit-limit-day"));
    if (Number.isFinite(perDay) && perDay > 0) this.perDay = perDay;
    const remDay = Number(headers.get("x-ratelimit-remaining-day"));
    if (Number.isFinite(remDay) && remDay >= 0) {
      this.rollDay();
      // Trust the server's view of what's left over our local count.
      this.daySpent = Math.max(this.daySpent, this.perDay - remDay);
    }
  }

  /** Wait until a request may be sent. Throws if the daily budget is spent. */
  async take(): Promise<void> {
    this.rollDay();
    if (this.daySpent >= this.perDay) {
      throw new Error(`daily rate budget exhausted (${this.perDay}/day) — resumes at UTC midnight`);
    }
    const rate = this.rate;
    const now = Date.now();
    this.tokens = Math.min(rate, this.tokens + ((now - this.last) / 60_000) * rate);
    this.last = now;
    if (this.tokens < 1) {
      const waitMs = Math.ceil((60_000 / rate) * (1 - this.tokens));
      await new Promise((r) => setTimeout(r, waitMs));
      const t = Date.now();
      this.tokens = Math.min(rate, this.tokens + ((t - this.last) / 60_000) * rate);
      this.last = t;
    }
    this.tokens = Math.max(0, this.tokens - 1);
    this.daySpent += 1;
  }
}

const buckets = new Map<string, Bucket>();

export function throttle(name: string): Bucket {
  let b = buckets.get(name);
  if (!b) {
    b = new Bucket(
      Number(process.env.RATE_LIMIT_PER_MIN ?? DEFAULT_PER_MIN),
      Number(process.env.RATE_LIMIT_PER_DAY ?? DEFAULT_PER_DAY),
    );
    buckets.set(name, b);
  }
  return b;
}

/** Test seam — reset all buckets. */
export function __resetThrottles(): void {
  buckets.clear();
}
