import { describe, expect, test } from "bun:test";
import bs58 from "bs58";
import nacl from "tweetnacl";

import {
  PraxisApiError,
  PraxisClient,
  keypairSigner,
  humanToBaseUnits,
  baseUnitsToHuman,
  type FetchLike,
} from "../src/index";

const BASE = "http://localhost:3000";

interface Recorded {
  method: string;
  path: string;
  body?: any;
  headers: Record<string, string>;
}

/** Build a fake fetch from a route table; records every call. */
function fakeServer(
  routes: Record<string, (req: Recorded) => { status?: number; body?: unknown; setCookie?: string }>,
): { fetch: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input);
    const path = url.pathname.replace("/api/praxis", "");
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    const key = `${init.method ?? "GET"} ${path}`;
    const recorded: Recorded = { method: init.method ?? "GET", path, body, headers };
    calls.push(recorded);

    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ error: `no route ${key}`, type: "Error" }), { status: 404 });

    const { status = 200, body: resBody, setCookie } = handler(recorded);
    const resHeaders = new Headers({ "content-type": "application/json" });
    if (setCookie) resHeaders.set("set-cookie", setCookie);
    return new Response(resBody === undefined ? "" : JSON.stringify(resBody), {
      status,
      headers: resHeaders,
    });
  };
  return { fetch, calls };
}

// A deterministic test keypair (32-byte seed → keypair).
const SEED = new Uint8Array(32).fill(7);
const KP = nacl.sign.keyPair.fromSeed(SEED);
const ADDRESS = bs58.encode(KP.publicKey);

describe("keypairSigner", () => {
  test("derives the address and produces a verifiable signature", () => {
    const signer = keypairSigner(SEED);
    expect(signer.address).toBe(ADDRESS);

    const msg = new TextEncoder().encode("hello praxis");
    const sig = signer.signMessage(msg) as Uint8Array;
    expect(sig.length).toBe(64);
    expect(nacl.sign.detached.verify(msg, sig, KP.publicKey)).toBe(true);
  });

  test("accepts a base58 secret key string", () => {
    const signer = keypairSigner(bs58.encode(KP.secretKey));
    expect(signer.address).toBe(ADDRESS);
  });
});

describe("connect()", () => {
  test("runs challenge → sign → verify and persists the session cookie", async () => {
    const message = "Praxis wants you to sign in...\nNonce: abc";
    const { fetch, calls } = fakeServer({
      "POST /auth/challenge": () => ({
        body: { address: ADDRESS, nonce: "nonce-token", message, expiresAt: "2099-01-01T00:00:00.000Z" },
      }),
      "POST /auth/verify": () => ({
        body: { authenticated: true, walletAddress: ADDRESS },
        setCookie: "praxis_session=signed.jwt.value; Path=/; HttpOnly; SameSite=Lax",
      }),
      "GET /get-policy": () => ({ body: { address: "pda", owner: ADDRESS, paused: false } }),
    });

    const client = new PraxisClient({ baseUrl: BASE, signer: keypairSigner(SEED), fetch });
    const session = await client.connect();
    expect(session.authenticated).toBe(true);
    expect(session.walletAddress).toBe(ADDRESS);

    // The signature sent to /auth/verify must verify against the signed message.
    const verifyCall = calls.find((c) => c.path === "/auth/verify")!;
    const sig = bs58.decode(verifyCall.body.signature);
    expect(nacl.sign.detached.verify(new TextEncoder().encode(message), sig, KP.publicKey)).toBe(true);
    expect(verifyCall.body.nonce).toBe("nonce-token");

    // The captured cookie rides along on the next request.
    await client.getPolicy();
    const policyCall = calls.find((c) => c.path === "/get-policy")!;
    expect(policyCall.headers["cookie"]).toBe("praxis_session=signed.jwt.value");
  });

  test("throws without a signer", () => {
    const client = new PraxisClient({ baseUrl: BASE, fetch: fakeServer({}).fetch });
    expect(client.connect()).rejects.toThrow(/requires a signer/);
  });
});

describe("ask()", () => {
  test("returns the agent reply and hydrates proposals", async () => {
    const { fetch } = fakeServer({
      "POST /send": () => ({ body: { threadId: "t1" } }),
      "GET /get-thread": () => ({
        body: {
          id: "t1",
          title: "send 0.5 SOL",
          updatedAt: 1,
          messages: [
            { id: "m1", role: "user", ts: 1, text: "send 0.5 SOL to maya" },
            { id: "m2", role: "agent", ts: 2, blocks: [{ type: "proposal", text: "Ready to send", proposalId: "p1" }] },
          ],
        },
      }),
      "GET /get-proposal": () => ({
        body: {
          id: "p1",
          detail: { kind: "transfer", amount: "500000000", recipientName: "Maya", recipientAddress: "Maya111", asset: { symbol: "SOL", mint: "So111", decimals: 9, verified: true } },
          networkFee: "5000",
          simulation: "Will succeed",
          check: { allowed: true, spentToday: "0", dailyLimit: "1000000000", remaining: "1000000000" },
          state: "pending",
        },
      }),
    });

    const client = new PraxisClient({ baseUrl: BASE, fetch });
    const result = await client.ask("send 0.5 SOL to maya");

    expect(result.threadId).toBe("t1");
    expect(result.message.role).toBe("agent");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].id).toBe("p1");
    expect(result.proposals[0].check.allowed).toBe(true);
    // Money stays a base-unit string on the wire.
    expect(result.proposals[0].detail).toMatchObject({ kind: "transfer", amount: "500000000" });
  });
});

describe("error handling", () => {
  test("maps the {error,type} envelope to PraxisApiError", async () => {
    const { fetch } = fakeServer({
      "GET /get-policy": () => ({ status: 429, body: { error: "slow down", type: "PraxisRateLimitError" } }),
    });
    const client = new PraxisClient({ baseUrl: BASE, fetch });

    try {
      await client.getPolicy();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PraxisApiError);
      const e = err as PraxisApiError;
      expect(e.status).toBe(429);
      expect(e.type).toBe("PraxisRateLimitError");
      expect(e.isRateLimited).toBe(true);
      expect(e.message).toBe("slow down");
    }
  });

  test("session() returns null on 401 instead of throwing", async () => {
    const { fetch } = fakeServer({
      "GET /auth/session": () => ({ status: 401, body: { error: "no session", type: "PraxisAuthError" } }),
    });
    const client = new PraxisClient({ baseUrl: BASE, fetch });
    expect(await client.session()).toBeNull();
  });

  // The real server answers 200 { authenticated: false } when signed out — not a 401.
  test("session() returns null on a 200 { authenticated: false }", async () => {
    const { fetch } = fakeServer({
      "GET /auth/session": () => ({ body: { authenticated: false } }),
    });
    const client = new PraxisClient({ baseUrl: BASE, fetch });
    expect(await client.session()).toBeNull();
  });

  test("session() returns the info when authenticated", async () => {
    const { fetch } = fakeServer({
      "GET /auth/session": () => ({ body: { authenticated: true, walletAddress: ADDRESS, expiresAt: 4102444800 } }),
    });
    const client = new PraxisClient({ baseUrl: BASE, fetch });
    const info = await client.session();
    expect(info?.authenticated).toBe(true);
    expect(info?.walletAddress).toBe(ADDRESS);
  });

  test("error helpers classify status codes", async () => {
    const { fetch } = fakeServer({
      "GET /get-thread": () => ({ status: 404, body: { error: "unknown thread x", type: "PraxisNotFoundError" } }),
      "GET /get-policy": () => ({ status: 503, body: { error: "config", type: "PraxisConfigError" } }),
      "GET /get-version": () => ({ status: 500, body: { error: "boom", type: "Error" } }),
    });
    const client = new PraxisClient({ baseUrl: BASE, fetch });

    await client.getThread("x").catch((e: PraxisApiError) => {
      expect(e.isNotFound).toBe(true);
      expect(e.isServer).toBe(false);
    });
    await client.getPolicy().catch((e: PraxisApiError) => {
      expect(e.isConfig).toBe(true);
      expect(e.isServer).toBe(true);
    });
    await client.getVersion().catch((e: PraxisApiError) => {
      expect(e.isServer).toBe(true);
      expect(e.isConfig).toBe(false);
    });
  });

  test("a client-side timeout throws a PraxisApiError with isTimeout", async () => {
    const hangingFetch: FetchLike = (_input, init = {}) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const client = new PraxisClient({ baseUrl: BASE, fetch: hangingFetch, timeoutMs: 10 });
    try {
      await client.getPolicy();
      throw new Error("should have timed out");
    } catch (err) {
      expect(err).toBeInstanceOf(PraxisApiError);
      const e = err as PraxisApiError;
      expect(e.isTimeout).toBe(true);
      expect(e.status).toBe(0);
    }
  });
});

describe("mutations", () => {
  test("fund/withdraw/delete hit their routes with the right bodies", async () => {
    const ok = () => ({ body: { ok: true } });
    const { fetch, calls } = fakeServer({
      "POST /fund-vault": ok,
      "POST /withdraw-vault": ok,
      "POST /delete-agent": ok,
    });
    const client = new PraxisClient({ baseUrl: BASE, fetch });

    await client.fundVault("1000000000");
    await client.withdrawVault("500000000");
    await client.deleteAgent();

    expect(calls.find((c) => c.path === "/fund-vault")?.body).toEqual({ amount: "1000000000" });
    expect(calls.find((c) => c.path === "/withdraw-vault")?.body).toEqual({ amount: "500000000" });
    expect(calls.find((c) => c.path === "/delete-agent")?.body).toEqual({});
  });

  test("submitOwnerTransaction posts the signed tx fields", async () => {
    const { fetch, calls } = fakeServer({
      "POST /owner/submit": () => ({ body: { sig: "5xSig" } }),
    });
    const client = new PraxisClient({ baseUrl: BASE, fetch });
    const res = await client.submitOwnerTransaction({
      transaction: "b64tx",
      blockhash: "hash",
      lastValidBlockHeight: 123,
    });
    expect(res.sig).toBe("5xSig");
    expect(calls[0].body).toEqual({ transaction: "b64tx", blockhash: "hash", lastValidBlockHeight: 123 });
  });

  test("logout posts DELETE and forgets the cookie", async () => {
    const { fetch, calls } = fakeServer({
      "DELETE /auth/session": () => ({ body: { authenticated: false } }),
    });
    const client = new PraxisClient({ baseUrl: BASE, fetch });
    await client.logout();
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].path).toBe("/auth/session");
  });
});

describe("units", () => {
  test("human ⇄ base units round-trips without floats", () => {
    expect(humanToBaseUnits("0.5", 9)).toBe("500000000");
    expect(humanToBaseUnits("1", 9)).toBe("1000000000");
    expect(humanToBaseUnits("10", 6)).toBe("10000000");
    expect(baseUnitsToHuman("500000000", 9)).toBe("0.5");
    expect(baseUnitsToHuman("1000000000", 9)).toBe("1");
    expect(baseUnitsToHuman("10000000", 6)).toBe("10");
  });

  test("rejects over-precise amounts", () => {
    expect(() => humanToBaseUnits("0.0000000001", 9)).toThrow();
  });

  test("baseUnitsToHuman handles zero and negative balances", () => {
    expect(baseUnitsToHuman("0", 9)).toBe("0");
    expect(baseUnitsToHuman(-500000000n, 9)).toBe("-0.5");
  });
});
