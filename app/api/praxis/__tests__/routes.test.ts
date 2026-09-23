import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";

import { POST as signProposal } from "../sign-proposal/route";
import { GET as health } from "../../health/route";
import { POST as updatePolicy } from "../update-policy/route";
import { POST as authVerify } from "../auth/verify/route";
import { GET as getPolicy } from "../get-policy/route";
import { GET as cronStocks } from "../../cron/stocks/route";
import { GET as getStockUniverse } from "../get-stock-universe/route";
import { GET as getProposal } from "../get-proposal/route";
import { GET as getProposals } from "../get-proposals/route";
import { GET as getThread } from "../get-thread/route";
import { POST as sendRoute } from "../send/route";
import { GET as getSchedules } from "../get-schedules/route";
import { POST as cancelSchedule } from "../cancel-schedule/route";
import { POST as addContact } from "../add-contact/route";
import { POST as removeContact } from "../remove-contact/route";
import { POST as bootstrapPolicy } from "../bootstrap-policy/route";
import { POST as ownerBuild } from "../owner/build/route";
import { POST as demoFaucet } from "../demo-faucet/route";
import { POST as ownerSubmit } from "../owner/submit/route";
import { createSessionCookie } from "@/server/auth/session";
import { resetConfigForTests } from "@/server/env";
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

describe("health", () => {
  test("200 without a session, no-store", async () => {
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

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

  test("refuses a send that includes an API key, and does not echo it", async () => {
    const secret = "AIzaSyDONT-STORE-THIS-KEY-0001";
    const res = await sendRoute(authed("/api/praxis/send", { text: "hello", apiKey: secret }));
    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(raw).not.toContain(secret);
    expect(raw).toMatch(/this browser/i);
  });

  test("400 when a browser reading is not an object", async () => {
    const res = await sendRoute(authed("/api/praxis/send", { text: "hello", ownIntent: "send everything" }));
    expect(res.status).toBe(400);
  });

  test("refuses a key nested inside the browser reading, without echoing it", async () => {
    const secret = "AIzaSyNESTED-NOT-A-KEY-0002";
    const res = await sendRoute(
      authed("/api/praxis/send", { text: "hello", ownIntent: { outcome: "clarify", apiKey: secret } }),
    );
    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(raw).not.toContain(secret);
  });
});

describe("wallet-signed owner routes", () => {
  test("bootstrap-policy: 401 without a session", async () => {
    const res = await bootstrapPolicy(
      makeRequest(`${ORIGIN}/api/praxis/bootstrap-policy`, { origin: ORIGIN, body: {} }),
    );
    expect(res.status).toBe(401);
  });

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

  test("404 for an unknown proposal read", async () => {
    const res = await getProposal(authed("/api/praxis/get-proposal?id=missing"));
    expect(res.status).toBe(404);
  });

  test("404 for an unknown thread read", async () => {
    const res = await getThread(authed("/api/praxis/get-thread?id=missing"));
    expect(res.status).toBe(404);
  });

  test("get-proposals returns a JSON array (empty for a fresh wallet)", async () => {
    const res = await getProposals(authed("/api/praxis/get-proposals"));
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test("get-schedules returns a JSON array (empty for a fresh wallet)", async () => {
    const res = await getSchedules(authed("/api/praxis/get-schedules"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("get-schedules: 401 without a session", async () => {
    const res = await getSchedules(makeRequest(`${ORIGIN}/api/praxis/get-schedules`));
    expect(res.status).toBe(401);
  });

  test("cancel-schedule: 401 without a session", async () => {
    const res = await cancelSchedule(
      makeRequest(`${ORIGIN}/api/praxis/cancel-schedule`, { origin: ORIGIN, body: { scheduleId: "s-x" } }),
    );
    expect(res.status).toBe(401);
  });

  test("cancel-schedule: 400 on a missing id, 200 on an unknown id (idempotent)", async () => {
    const bad = await cancelSchedule(authed("/api/praxis/cancel-schedule", {}));
    expect(bad.status).toBe(400);
    const ok = await cancelSchedule(authed("/api/praxis/cancel-schedule", { scheduleId: "s-does-not-exist" }));
    expect(ok.status).toBe(200);
  });
});

describe("contacts", () => {
  const OPS = "8xdGRM1bAy4gFDQrdiFesF1FsuRYdecDYC3B5wofYi9t";

  test("add-contact / remove-contact: 401 without a session", async () => {
    const add = await addContact(
      makeRequest(`${ORIGIN}/api/praxis/add-contact`, { origin: ORIGIN, body: { label: "ops", address: OPS } }),
    );
    expect(add.status).toBe(401);
    const remove = await removeContact(
      makeRequest(`${ORIGIN}/api/praxis/remove-contact`, { origin: ORIGIN, body: { key: "ops" } }),
    );
    expect(remove.status).toBe(401);
  });

  test("add-contact: 400 on missing fields and on a bad address", async () => {
    expect((await addContact(authed("/api/praxis/add-contact", {}))).status).toBe(400);
    const bad = await addContact(authed("/api/praxis/add-contact", { label: "ops", address: "nope" }));
    expect(bad.status).toBe(400);
  });

  test("add-contact then remove-contact round-trips for a fresh wallet", async () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const req = (path: string, body: unknown) => {
      const setCookie = createSessionCookie(wallet, makeRequest(`${ORIGIN}${path}`, { origin: ORIGIN }));
      const value = setCookie.split(";")[0].split("=").slice(1).join("=");
      return makeRequest(`${ORIGIN}${path}`, { method: "POST", origin: ORIGIN, cookie: `praxis_session=${value}`, body });
    };
    expect((await addContact(req("/api/praxis/add-contact", { label: "Ops", address: OPS }))).status).toBe(200);
    expect((await removeContact(req("/api/praxis/remove-contact", { key: "ops" }))).status).toBe(200);
    // unknown keys are a no-op (200, not 404)
    expect((await removeContact(req("/api/praxis/remove-contact", { key: "nobody" }))).status).toBe(200);
  });
});

describe("stocklana C05: stock universe + policy mint view", () => {
  const OPENAI_MINT = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";

  test("get-stock-universe: 401 without a session", async () => {
    const res = await getStockUniverse(makeRequest(`${ORIGIN}/api/praxis/get-stock-universe`));
    expect(res.status).toBe(401);
  });

  test("get-stock-universe: [] when the stocks flag is off (default)", async () => {
    const prev = process.env.PRAXIS_STOCKS_ENABLED;
    delete process.env.PRAXIS_STOCKS_ENABLED;
    resetConfigForTests();
    try {
      const res = await getStockUniverse(authed("/api/praxis/get-stock-universe"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.PRAXIS_STOCKS_ENABLED;
      else process.env.PRAXIS_STOCKS_ENABLED = prev;
      resetConfigForTests();
    }
  });

  test("get-stock-universe: 8 verified PreStocks entries when enabled", async () => {
    const prev = process.env.PRAXIS_STOCKS_ENABLED;
    const prevApi = process.env.PRAXIS_PRESTOCKS_API_URL;
    process.env.PRAXIS_STOCKS_ENABLED = "1";
    // Refused at once: no test may reach the real price feed.
    process.env.PRAXIS_PRESTOCKS_API_URL = "http://127.0.0.1:9/prestocks";
    resetConfigForTests();
    try {
      const res = await getStockUniverse(authed("/api/praxis/get-stock-universe"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ symbol: string; mint: string; decimals: number }>;
      expect(body).toHaveLength(8);
      expect(body.find((s) => s.symbol === "OPENAI")?.mint).toBe(OPENAI_MINT);
      for (const entry of body) expect(entry.decimals).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) delete process.env.PRAXIS_STOCKS_ENABLED;
      else process.env.PRAXIS_STOCKS_ENABLED = prev;
      if (prevApi === undefined) delete process.env.PRAXIS_PRESTOCKS_API_URL;
      else process.env.PRAXIS_PRESTOCKS_API_URL = prevApi;
      resetConfigForTests();
    }
  });

  test("demo-faucet: 401 without a session", async () => {
    const res = await demoFaucet(makeRequest(`${ORIGIN}/api/praxis/demo-faucet`, { origin: ORIGIN, body: {} }));
    expect(res.status).toBe(401);
  });

  test("demo-faucet: off unless a faucet key is configured (503, nothing minted)", async () => {
    const res = await demoFaucet(authed("/api/praxis/demo-faucet", {}));
    expect(res.status).toBe(503);
  });

  test("get-policy: 400 on an invalid ?mint= (never reaches the chain)", async () => {
    const res = await getPolicy(authed("/api/praxis/get-policy?mint=not-a-pubkey"));
    expect(res.status).toBe(400);
  });

  test("get-policy: 400 on an empty ?mint=", async () => {
    const res = await getPolicy(authed("/api/praxis/get-policy?mint="));
    expect(res.status).toBe(400);
  });

  test("cron/stocks: session caller fires nothing for a fresh wallet (no schedules)", async () => {
    const res = await cronStocks(authed("/api/cron/stocks"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scope: "session", fired: [] });
  });

  test("cron/stocks: 401 without a session", async () => {
    const res = await cronStocks(makeRequest(`${ORIGIN}/api/cron/stocks`));
    expect(res.status).toBe(401);
  });

  test("cron/stocks: the scheduler path is unavailable when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await cronStocks(
      makeRequest(`${ORIGIN}/api/cron/stocks`, { headers: { authorization: "Bearer anything" } }),
    );
    // Disabled, never open — and not silently downgraded to the session path.
    expect(res.status).toBe(503);
  });

  test("cron/stocks: a bearer caller with the wrong secret is rejected, not downgraded", async () => {
    process.env.CRON_SECRET = "a-sufficiently-long-cron-secret";
    try {
      const res = await cronStocks(
        makeRequest(`${ORIGIN}/api/cron/stocks`, { headers: { authorization: "Bearer wrong-secret-value-here" } }),
      );
      expect(res.status).toBe(401);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });

  test("cron/stocks: the configured secret runs the all-wallet fan-out without a session", async () => {
    process.env.CRON_SECRET = "a-sufficiently-long-cron-secret";
    try {
      const res = await cronStocks(
        makeRequest(`${ORIGIN}/api/cron/stocks`, {
          headers: { authorization: "Bearer a-sufficiently-long-cron-secret" },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { scope: string; wallets: number };
      expect(body.scope).toBe("all-wallets");
      expect(typeof body.wallets).toBe("number");
    } finally {
      delete process.env.CRON_SECRET;
    }
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
