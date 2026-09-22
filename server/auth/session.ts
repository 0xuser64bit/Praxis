import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { PublicKey } from "@solana/web3.js";

import { PraxisAuthError, PraxisConfigError } from "../errors";

export interface PraxisSession {
  walletAddress: string;
  issuedAt: number;
  expiresAt: number;
}

interface SessionPayload {
  v: 1;
  sub: string;
  iat: number;
  exp: number;
}

export const SESSION_COOKIE = "praxis_session";
const MIN_SECRET_LENGTH = 32;

/**
 * How long a wallet session lasts.
 *
 * This cookie is not only proof of identity. Praxis signs agent transfers
 * with its own scoped key, so holding a valid session is enough to move money
 * out of the vault — bounded by the Aegis envelope, but without a further
 * wallet signature. That makes the session a spending credential, and a
 * week-long default is a web-app habit rather than a decision about one.
 *
 * A day, overridable for deployments that want a different trade-off. The
 * envelope, not this, is what bounds the damage either way; this bounds how
 * long a stolen cookie keeps working.
 */
const DEFAULT_SESSION_TTL_HOURS = 24;
const MAX_SESSION_TTL_HOURS = 24 * 7;

function sessionTtlSeconds(): number {
  const raw = Number(process.env.PRAXIS_SESSION_TTL_HOURS);
  const hours = Number.isFinite(raw) && raw > 0 && raw <= MAX_SESSION_TTL_HOURS
    ? raw
    : DEFAULT_SESSION_TTL_HOURS;
  return Math.round(hours * 3600);
}

let devSecret: string | undefined;

export function createSessionCookie(walletAddress: string, request: Request): string {
  const now = nowSeconds();
  const ttl = sessionTtlSeconds();
  const payload: SessionPayload = {
    v: 1,
    sub: normalizeWallet(walletAddress),
    iat: now,
    exp: now + ttl,
  };
  return serializeCookie(SESSION_COOKIE, signPayload(payload), {
    request,
    maxAge: ttl,
    httpOnly: true,
  });
}

export function clearSessionCookie(request: Request): string {
  return serializeCookie(SESSION_COOKIE, "", {
    request,
    maxAge: 0,
    httpOnly: true,
  });
}

export function readSession(request: Request): PraxisSession | null {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;
  const now = nowSeconds();
  if (payload.exp <= now) return null;
  // Reject tokens minted in the future (clock skew tolerance 60s) — a forged
  // or replayed iat far ahead would otherwise extend the session window.
  if (payload.iat > now + 60) return null;
  // A cookie minted under a longer TTL must not outlive the current policy:
  // shortening PRAXIS_SESSION_TTL_HOURS has to take effect for sessions
  // already issued, or the setting only applies to people who sign in again.
  if (payload.exp - payload.iat > sessionTtlSeconds()) return null;

  return {
    walletAddress: payload.sub,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

export function requireSession(request: Request): PraxisSession {
  const session = readSession(request);
  if (!session) {
    throw new PraxisAuthError("Sign in with your Solana wallet to use the Praxis API.");
  }
  return session;
}

export function normalizeWallet(value: string): string {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new PraxisAuthError("wallet address must be a valid Solana public key");
  }
}

function signPayload(payload: SessionPayload): string {
  const encoded = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = hmac(encoded);
  return `${encoded}.${sig}`;
}

function verifyToken(token: string): SessionPayload | null {
  const [encoded, sig, extra] = token.split(".");
  if (!encoded || !sig || extra !== undefined) return null;
  if (!safeEqual(sig, hmac(encoded))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (parsed.v !== 1) return null;
    if (typeof parsed.sub !== "string") return null;
    if (typeof parsed.iat !== "number" || !Number.isSafeInteger(parsed.iat)) return null;
    if (typeof parsed.exp !== "number" || !Number.isSafeInteger(parsed.exp)) return null;
    return {
      v: 1,
      sub: normalizeWallet(parsed.sub),
      iat: parsed.iat,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export function signWithSessionSecret(value: string): string {
  return base64UrlEncode(createHmac("sha256", sessionSecret()).update(value).digest());
}

function hmac(value: string): string {
  return signWithSessionSecret(value);
}

function sessionSecret(): string {
  const configured = process.env.PRAXIS_SESSION_SECRET?.trim();
  if (configured) {
    if (configured.length < MIN_SECRET_LENGTH) {
      throw new PraxisConfigError(
        `PRAXIS_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`,
      );
    }
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new PraxisConfigError("PRAXIS_SESSION_SECRET is required in production API mode.");
  }

  // Local-only fallback so developers can exercise API auth without committing
  // a secret. Sessions rotate on process restart and are never valid in prod.
  devSecret ??= randomBytes(32).toString("base64url");
  return devSecret;
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function serializeCookie(
  name: string,
  value: string,
  opts: { request: Request; maxAge: number; httpOnly: boolean },
): string {
  const secure = isSecureRequest(opts.request);
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${opts.maxAge}`,
    "SameSite=Lax",
    opts.httpOnly ? "HttpOnly" : "",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function isSecureRequest(request: Request): boolean {
  if (new URL(request.url).protocol === "https:") return true;
  return process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function base64UrlEncode(value: Buffer): string {
  return value.toString("base64url");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
