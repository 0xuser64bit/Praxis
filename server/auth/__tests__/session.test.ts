import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { Keypair } from "@solana/web3.js";

import { clearSessionCookie, createSessionCookie, normalizeWallet, readSession } from "../session";
import { makeRequest } from "../../testing/fixtures";

const SECRET = "test-session-secret-at-least-32-chars-long";
const URL = "https://praxis.test/api/praxis/get-policy";

function cookieValue(setCookie: string): string {
  const first = setCookie.split(";")[0];
  return first.slice(first.indexOf("=") + 1);
}

function requestWithCookie(setCookie: string): Request {
  return makeRequest(URL, { cookie: `praxis_session=${cookieValue(setCookie)}` });
}

/** Forge a token with arbitrary payload, signed with the active secret. */
function forgeToken(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", SECRET).update(encoded).digest().toString("base64url");
  return `${encoded}.${sig}`;
}

describe("session cookies", () => {
  let prevSecret: string | undefined;
  let prevNodeEnv: string | undefined;

  beforeEach(() => {
    prevSecret = process.env.PRAXIS_SESSION_SECRET;
    prevNodeEnv = process.env.NODE_ENV;
    process.env.PRAXIS_SESSION_SECRET = SECRET;
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.PRAXIS_SESSION_SECRET;
    else process.env.PRAXIS_SESSION_SECRET = prevSecret;
    if (prevNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", prevNodeEnv);
  });

  test("signs and verifies a wallet session round-trip", () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const setCookie = createSessionCookie(wallet, makeRequest(URL));
    const session = readSession(requestWithCookie(setCookie));
    expect(session?.walletAddress).toBe(wallet);
    expect(session?.expiresAt).toBeGreaterThan(session!.issuedAt);
  });

  test("a tampered token does not verify", () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const setCookie = createSessionCookie(wallet, makeRequest(URL));
    const value = cookieValue(setCookie);
    const tampered = value.slice(0, -2) + (value.endsWith("A") ? "BB" : "AA");
    const session = readSession(makeRequest(URL, { cookie: `praxis_session=${tampered}` }));
    expect(session).toBeNull();
  });

  test("a token signed with a different secret is rejected", () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const setCookie = createSessionCookie(wallet, makeRequest(URL));
    process.env.PRAXIS_SESSION_SECRET = "a-totally-different-secret-32-chars-xx";
    expect(readSession(requestWithCookie(setCookie))).toBeNull();
  });

  test("an expired token returns null", () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const now = Math.floor(Date.now() / 1000);
    const token = forgeToken({ v: 1, sub: wallet, iat: now - 10_000, exp: now - 10 });
    expect(readSession(makeRequest(URL, { cookie: `praxis_session=${token}` }))).toBeNull();
  });

  test("rejects a malformed (three-segment) token", () => {
    expect(readSession(makeRequest(URL, { cookie: "praxis_session=a.b.c" }))).toBeNull();
  });

  test("missing cookie yields no session", () => {
    expect(readSession(makeRequest(URL))).toBeNull();
  });

  test("clear cookie expires the session", () => {
    const cleared = clearSessionCookie(makeRequest(URL));
    expect(cleared).toContain("Max-Age=0");
  });

  test("a too-short configured secret is rejected", () => {
    process.env.PRAXIS_SESSION_SECRET = "short";
    expect(() => createSessionCookie(Keypair.generate().publicKey.toBase58(), makeRequest(URL))).toThrow(
      /at least 32 characters/,
    );
  });

  test("production requires an explicit secret", () => {
    delete process.env.PRAXIS_SESSION_SECRET;
    Reflect.set(process.env, "NODE_ENV", "production");
    expect(() => createSessionCookie(Keypair.generate().publicKey.toBase58(), makeRequest(URL))).toThrow(
      /required in production/,
    );
  });

  test("normalizeWallet rejects a non-key", () => {
    expect(() => normalizeWallet("not-a-key")).toThrow();
  });
});
