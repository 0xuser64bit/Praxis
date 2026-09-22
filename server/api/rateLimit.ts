import { PraxisRateLimitError } from "../errors";
import { getRateLimiter } from "./rateLimiter";

interface RateLimitOptions {
  scope: string;
  identity?: string;
  limit: number;
  windowMs: number;
}

/**
 * Enforce a fixed-window rate limit for `request` under `options`. Backed by the
 * configured {@link RateLimiter} (process-local memory by default, Redis across
 * instances when configured). Throws {@link PraxisRateLimitError} when exceeded.
 */
export async function assertRateLimit(request: Request, options: RateLimitOptions): Promise<void> {
  const key = [
    options.scope,
    options.identity ?? requestIp(request),
    new URL(request.url).pathname,
  ].join(":");

  const verdict = await getRateLimiter().hit(key, options.limit, options.windowMs);
  if (!verdict.allowed) {
    const wait = Math.max(1, Math.ceil(verdict.retryAfterMs / 1000));
    throw new PraxisRateLimitError(`Too many Praxis requests. Try again in ${wait}s.`);
  }
}

/**
 * The caller's address, for limits that have no wallet to key on.
 *
 * Order matters. `x-forwarded-for` is the header a client can set itself: a
 * proxy that appends rather than overwrites leaves the attacker's value in
 * front, and reading the leftmost entry then hands every request a fresh
 * identity — a rate limit anyone can opt out of. Headers the platform sets
 * itself come first; XFF is the last resort, and a deployment that relies on
 * it must front the app with a proxy that overwrites the header.
 */
function requestIp(request: Request): string {
  const trusted =
    request.headers.get("x-vercel-forwarded-for")?.trim()
    || request.headers.get("x-real-ip")?.trim();
  if (trusted) return trusted;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
