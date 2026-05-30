import { fetchWithTimeout } from "./timeout";
import { logger } from "../observability/logger";

export interface RateLimitVerdict {
  allowed: boolean;
  /** Milliseconds until the window resets (best-effort). */
  retryAfterMs: number;
}

/**
 * A fixed-window rate limiter. The memory backend is process-local (fine for a
 * single instance / local dev); the Redis backend coordinates across serverless
 * instances. Selected by env so platform-level limiting is a config switch.
 */
export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitVerdict>;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxBuckets: number;

  constructor(maxBuckets = 10_000) {
    this.maxBuckets = maxBuckets;
  }

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitVerdict> {
    const now = Date.now();
    this.prune(now);

    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }

    current.count += 1;
    if (current.count > limit) {
      return { allowed: false, retryAfterMs: Math.max(1, current.resetAt - now) };
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  private prune(now: number) {
    if (this.buckets.size < this.maxBuckets) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    if (this.buckets.size < this.maxBuckets) return;
    const overflow = this.buckets.size - this.maxBuckets;
    let deleted = 0;
    for (const key of this.buckets.keys()) {
      this.buckets.delete(key);
      if (++deleted >= overflow) return;
    }
  }
}

type FetchLike = typeof fetch;

/**
 * Upstash-Redis-compatible REST limiter (works with Vercel KV too). Fixed window
 * via INCR + EXPIRE NX in one pipeline. Fails OPEN on a limiter outage — a rate
 * limiter must never take down the API — and logs the failure.
 */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitVerdict> {
    const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
    const redisKey = `praxis:ratelimit:${key}`;
    try {
      const res = await fetchWithTimeout(
        `${this.url}/pipeline`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
          body: JSON.stringify([
            ["INCR", redisKey],
            ["EXPIRE", redisKey, String(windowSec), "NX"],
          ]),
        },
        { ms: 2_000, label: "rate limiter" },
        this.fetchImpl,
      );
      if (!res.ok) {
        logger.warn("ratelimit.redis_unavailable", { status: res.status });
        return { allowed: true, retryAfterMs: 0 };
      }
      const data = (await res.json()) as Array<{ result?: unknown }>;
      const count = Number(data?.[0]?.result ?? 0);
      if (count > limit) return { allowed: false, retryAfterMs: windowMs };
      return { allowed: true, retryAfterMs: 0 };
    } catch (error) {
      logger.warn("ratelimit.redis_error", { error: error instanceof Error ? error.message : String(error) });
      return { allowed: true, retryAfterMs: 0 };
    }
  }
}

let cached: RateLimiter | undefined;

function redisCreds(): { url: string; token: string } | undefined {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.KV_REST_API_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim();
  return url && token ? { url, token } : undefined;
}

export function getRateLimiter(): RateLimiter {
  if (cached) return cached;
  const mode = process.env.PRAXIS_RATE_LIMITER?.trim().toLowerCase();
  const creds = redisCreds();
  if (mode === "redis" || (mode !== "memory" && creds)) {
    if (!creds) {
      // Explicit redis without creds — fall back to memory but make it visible.
      logger.warn("ratelimit.redis_requested_without_credentials");
      cached = new MemoryRateLimiter();
    } else {
      cached = new RedisRateLimiter(creds.url, creds.token);
    }
  } else {
    cached = new MemoryRateLimiter();
  }
  return cached;
}

export function resetRateLimiterForTests(limiter?: RateLimiter) {
  cached = limiter;
}
