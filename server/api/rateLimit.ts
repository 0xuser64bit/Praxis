import { PraxisRateLimitError } from "../errors";

interface RateLimitOptions {
  scope: string;
  identity?: string;
  limit: number;
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export function assertRateLimit(request: Request, options: RateLimitOptions) {
  const now = Date.now();
  prune(now);

  const key = [
    options.scope,
    options.identity ?? requestIp(request),
    new URL(request.url).pathname,
  ].join(":");

  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return;
  }

  current.count += 1;
  if (current.count > options.limit) {
    const wait = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    throw new PraxisRateLimitError(`Too many Praxis requests. Try again in ${wait}s.`);
  }
}

function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return request.headers.get("x-real-ip")?.trim() || "local";
}

function prune(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size < MAX_BUCKETS) return;

  const overflow = buckets.size - MAX_BUCKETS;
  let deleted = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    deleted++;
    if (deleted >= overflow) return;
  }
}
