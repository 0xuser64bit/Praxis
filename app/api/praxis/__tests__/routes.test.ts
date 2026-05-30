import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";

import { POST as signProposal } from "../sign-proposal/route";
import { POST as updatePolicy } from "../update-policy/route";
import { POST as authVerify } from "../auth/verify/route";
import { GET as getPolicy } from "../get-policy/route";
import { POST as sendRoute } from "../send/route";
import { POST as ownerBuild } from "../owner/build/route";
import { POST as ownerSubmit } from "../owner/submit/route";
import { createSessionCookie } from "@/server/auth/session";
import { makeRequest } from "@/server/testing/fixtures";

const ORIGIN = "https://praxis.test";
let prevSecret: string | undefined;

beforeAll(() => {
  prevSecret = process.env.PRAXIS_SESSION_SECRET;
  process.env.PRAXIS_SESSION_SECRET = "route-test-secret-at-least-32-characters";
});

afterAll(() => {
  if (prevSecret === undefined) delete process.env.PRAXIS_SESSION_SECRET;
  else process.env.PRAXIS_SESSION_SECRET = prevSecret;
});

/** A fresh authenticated, same-origin request for a unique wallet per call. */
function authed(path: string, body?: unknown): Request {
  const wallet = Keypair.generate().publicKey.toBase58();
  const setCookie = createSessionCookie(wallet, makeRequest(`${ORIGIN}${path}`, { origin: ORIGIN }));
  const value = setCookie.split(";")[0].split("=").slice(1).join("=");
  return makeRequest(`${ORIGIN}${path}`, {
    method: body === undefined ? "GET" : "POST",
    origin: ORIGIN,
    cookie: `praxis_session=${value}`,
    body,
  });
}

describe("mutation auth gating", () => {
  test("401 without a session", async () => {
    const res = await signProposal(makeRequest(`${ORIGIN}/api/praxis/sign-proposal`, { origin: ORIGIN, body: { proposalId: "p1" } }));
    expect(res.status).toBe(401);
  });

  test("rejects a cross-origin mutation (401 auth-class) even with a valid session", async () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const setCookie = createSessionCookie(wallet, makeRequest(`${ORIGIN}/x`, { origin: ORIGIN }));
    const value = setCookie.split(";")[0].split("=").slice(1).join("=");
    const res = await signProposal(
      makeRequest(`${ORIGIN}/api/praxis/sign-proposal`, {
        origin: "https://evil.test",
        cookie: `praxis_session=${value}`,
        body: { proposalId: "p1" },
      }),
    );
    // assertSameOrigin throws PraxisAuthError → 401 (the CSRF guard is auth-class).
    expect(res.status).toBe(401);
  });

  test("400 on a missing required field with a valid session", async () => {
    const res = await signProposal(authed("/api/praxis/sign-proposal", {}));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/proposalId/);
  });

  test("400 on an invalid policy patch", async () => {
    const res = await updatePolicy(authed("/api/praxis/update-policy", { patch: { paused: "yes" } }));
    expect(res.status).toBe(400);
  });

  test("404 for an unknown proposal (passes auth, fails in the provider)", async () => {
    const res = await signProposal(authed("/api/praxis/sign-proposal", { proposalId: "does-not-exist" }));
    expect(res.status).toBe(404);
  });

  test("400 on an oversized send payload", async () => {
    const res = await sendRoute(authed("/api/praxis/send", { text: "x".repeat(2_001) }));
    expect(res.status).toBe(400);
  });
});

describe("wallet-signed owner routes", () => {
  test("owner/build: 401 without a session", async () => {
    const res = await ownerBuild(
      makeRequest(`${ORIGIN}/api/praxis/owner/build`, { origin: ORIGIN, body: { action: { kind: "revoke" } } }),
    );
    expect(res.status).toBe(401);
  });

  test("owner/build: 400 on an invalid action with a valid session", async () => {
    const res = await ownerBuild(authed("/api/praxis/owner/build", { action: { kind: "wat" } }));
    expect(res.status).toBe(400);
  });

  test("owner/submit: 401 without a session", async () => {
    const res = await ownerSubmit(
      makeRequest(`${ORIGIN}/api/praxis/owner/submit`, {
        origin: ORIGIN,
        body: { transaction: "AQID", blockhash: "h", lastValidBlockHeight: 1 },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("owner/submit: 400 on a missing transaction with a valid session", async () => {
    const res = await ownerSubmit(authed("/api/praxis/owner/submit", { blockhash: "h", lastValidBlockHeight: 1 }));
    expect(res.status).toBe(400);
  });
});

describe("read auth gating", () => {
  test("401 without a session", async () => {
    const res = await getPolicy(makeRequest(`${ORIGIN}/api/praxis/get-policy`));
    expect(res.status).toBe(401);
  });

  test("read responses are marked no-store", async () => {
    const res = await getPolicy(makeRequest(`${ORIGIN}/api/praxis/get-policy`));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("auth/verify", () => {
  test("rejects cross-origin (401 auth-class)", async () => {
    const res = await authVerify(
      makeRequest(`${ORIGIN}/api/praxis/auth/verify`, {
        origin: "https://evil.test",
        body: { address: "x", nonce: "y", signature: "z" },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("400 on missing fields", async () => {
    const res = await authVerify(makeRequest(`${ORIGIN}/api/praxis/auth/verify`, { origin: ORIGIN, body: {} }));
    expect(res.status).toBe(400);
  });
});
