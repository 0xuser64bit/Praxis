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

function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return request.headers.get("x-real-ip")?.trim() || "local";
}
