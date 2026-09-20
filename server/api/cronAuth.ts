import { timingSafeEqual } from "node:crypto";

import { PraxisAuthError, PraxisConfigError } from "../errors";

/**
 * Bearer-token auth for unattended scheduled jobs.
 *
 * A cron has no wallet and no session cookie, so it cannot use the normal
 * session guard. It authenticates with `CRON_SECRET` (the variable Vercel Cron
 * sends automatically as `Authorization: Bearer …`).
 *
 * Fails closed in both directions: with no secret configured the job endpoint
 * is not merely unauthenticated, it is unavailable — there is no state in
 * which an unauthenticated caller can drive it.
 */
const MIN_SECRET_LENGTH = 16;

export function cronSecretConfigured(): boolean {
  return Boolean(process.env.CRON_SECRET?.trim());
}

/** Throws unless the request carries the configured cron secret. */
export function assertCronAuthorized(request: Request): void {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    throw new PraxisConfigError("CRON_SECRET is not configured; the scheduled-buy job is disabled.");
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new PraxisConfigError(`CRON_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
  }

  const presented = bearerToken(request);
  if (!presented || !safeEqual(presented, secret)) {
    throw new PraxisAuthError("Scheduled-job authorization failed.");
  }
}

/** True when the request presents *some* bearer token (not that it is valid). */
export function hasBearerToken(request: Request): boolean {
  return bearerToken(request) !== undefined;
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization")?.trim();
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || undefined;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // Length is not secret, but comparing different-length buffers throws.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
