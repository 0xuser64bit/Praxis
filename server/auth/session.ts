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
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

let devSecret: string | undefined;

export function createSessionCookie(walletAddress: string, request: Request): string {
  const now = nowSeconds();
  const payload: SessionPayload = {
    v: 1,
    sub: normalizeWallet(walletAddress),
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  return serializeCookie(SESSION_COOKIE, signPayload(payload), {
    request,
    maxAge: SESSION_TTL_SECONDS,
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
  if (payload.exp <= nowSeconds()) return null;

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

function hmac(value: string): string {
  return base64UrlEncode(createHmac("sha256", sessionSecret()).update(value).digest());
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
