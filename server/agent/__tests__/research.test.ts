import { afterEach, describe, expect, test } from "bun:test";
import type { Connection } from "@solana/web3.js";

import type { PraxisServerConfig } from "../../env";
import { researchToken } from "../research";
import type { TokenResolution } from "../tokenResolve";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WSOL = "So11111111111111111111111111111111111111112";

type Resolved = Extract<TokenResolution, { kind: "resolved" }>;

function resolved(overrides: Partial<Resolved> = {}): Resolved {
  return {
    kind: "resolved",
    token: { symbol: "BONK", mint: BONK, decimals: 5, verified: true },
    via: "catalog",
    alternatives: [],
    ...overrides,
  };
}

function config(): PraxisServerConfig {
  return {
    commitment: "confirmed",
    researchRpcUrl: "https://rpc.example.com/?api-key=super-secret",
    stocksEnabled: false,
    tokens: [],
  } as unknown as PraxisServerConfig;
}

/** An RPC where supply answers and the holder query is rate-limited — the
 *  shape every default deployment actually sees on the public endpoint. */
function rpc(opts: { supply?: boolean; holders?: boolean } = {}): Connection {
  return {
    getTokenSupply: async () =>
      opts.supply === false
        ? Promise.reject(new Error("failed to get token supply: Invalid param: could not find account"))
        : { value: { amount: "8799439795288185356", decimals: 5, uiAmountString: "87994397952881.85356" } },
    getTokenLargestAccounts: async () =>
      opts.holders
        ? { value: [{ amount: "4399719897644092678" }] }
        : Promise.reject(new Error("429 Too Many Requests")),
    getSupply: async () => ({ value: { circulating: 587_436_957_000_000_000n } }),
  } as unknown as Connection;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function indexerReturning(pairs: unknown[]): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify({ pairs }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof globalThis.fetch;
}

const PAIR = {
  chainId: "solana",
  dexId: "raydium",
  priceUsd: "0.000003363",
  priceChange: { h24: 12.31 },
  volume: { h24: 1_042_102.99 },
  liquidity: { usd: 249_356_112 },
  marketCap: 295_942_546,
  baseToken: { symbol: "BONK", name: "Bonk", address: BONK },
  quoteToken: { symbol: "SOL" },
};

describe("the card shows its working", () => {
  test("every source says what it was asked and what came back", async () => {
    globalThis.fetch = indexerReturning([PAIR]);
    const data = await researchToken(resolved(), rpc(), config());

    expect(data.sources?.map((s) => [s.label, s.status])).toEqual([
      ["Token resolution", "ok"],
      ["Solana RPC (rpc.example.com)", "partial"],
      ["Market data (api.dexscreener.com)", "ok"],
    ]);
    // "unavailable" is a shrug; the reason is the useful part.
    expect(data.sources?.[1].detail).toMatch(/rate-limited this call/);
    expect(data.sources?.[2].detail).toMatch(/1 Solana pair;.*raydium, BONK\/SOL/);
  });

  /** A provider RPC carries its API key in the query string. */
  test("the RPC is named by host, never by URL", async () => {
    globalThis.fetch = indexerReturning([PAIR]);
    const data = await researchToken(resolved(), rpc(), config());
    expect(JSON.stringify(data)).not.toContain("super-secret");
  });

  test("a mint the RPC's cluster has never seen says exactly that", async () => {
    globalThis.fetch = indexerReturning([]);
    const data = await researchToken(resolved(), rpc({ supply: false }), config());
    expect(data.sources?.[1].status).toBe("unavailable");
    expect(data.sources?.[1].detail).toMatch(/not on the cluster the research RPC points at/);
    expect(data.sources?.[2].detail).toMatch(/No Solana pair/);
  });

  test("native SOL is not missing holder data — the metric does not apply", async () => {
    globalThis.fetch = indexerReturning([{ ...PAIR, baseToken: { symbol: "SOL", address: WSOL } }]);
    const data = await researchToken(
      resolved({ token: { symbol: "SOL", mint: WSOL, decimals: 9, verified: true } }),
      rpc(),
      config(),
    );
    expect(data.metrics.some((m) => m.label === "Top 10 concentration")).toBe(false);
    expect(data.sources?.[1].status).toBe("ok");
    expect(data.sources?.[1].detail).toMatch(/does not apply to native SOL/);
  });
});

describe("a pasted mint is named by the indexer, not by slicing the address", () => {
  test("the card says TRUMP / OFFICIAL TRUMP, not 6P6XGH", async () => {
    globalThis.fetch = indexerReturning([
      { ...PAIR, baseToken: { symbol: "TRUMP", name: "OFFICIAL TRUMP", address: BONK } },
    ]);
    const data = await researchToken(
      resolved({ token: { symbol: "", mint: BONK, decimals: 0, verified: false }, via: "mint" }),
      rpc(),
      config(),
    );
    expect(data.token).toBe("TRUMP");
    expect(data.name).toBe("OFFICIAL TRUMP");
  });

  test("a mint with no pair anywhere still renders, shortened", async () => {
    globalThis.fetch = indexerReturning([]);
    const data = await researchToken(
      resolved({ token: { symbol: "", mint: BONK, decimals: 0, verified: false }, via: "mint" }),
      rpc(),
      config(),
    );
    expect(data.token).toBe("DezXAZ…pPB263");
  });
});

test("the concentration row explains itself whether or not it has a value", async () => {
  globalThis.fetch = indexerReturning([PAIR]);
  const missing = await researchToken(resolved(), rpc(), config());
  const present = await researchToken(resolved(), rpc({ holders: true }), config());

  const row = (d: Awaited<ReturnType<typeof researchToken>>) =>
    d.metrics.find((m) => m.label === "Top 10 concentration");

  expect(row(missing)?.value).toBe("unavailable");
  expect(row(missing)?.note).toMatch(/ten largest token accounts.*rate-limits/s);
  expect(row(present)?.value).toBe("50.00%");
  expect(row(present)?.note).toMatch(/ten largest token accounts/);
});

/**
 * An indexer timeout used to throw out of `researchToken` and become the
 * whole chat reply — "Token indexer lookup timed out after 4000ms" — taking
 * the on-chain data that HAD loaded down with it. Every other read here
 * degrades; this one has to as well.
 */
describe("an indexer outage costs the market rows, not the card", () => {
  test("on-chain data survives, and the trail separates an outage from 'no market'", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Token indexer lookup timed out after 4000ms");
    }) as unknown as typeof globalThis.fetch;

    const data = await researchToken(resolved(), rpc(), config());
    expect(data.metrics.find((m) => m.label === "Supply")?.value).toBe("87.99T");
    expect(data.metrics.find((m) => m.label === "Price")?.note).toMatch(/market-data lookup failed/);
    expect(data.sources?.[2].detail).toMatch(/did not complete \(no answer before the read timeout\)/);
  });
});
