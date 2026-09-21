import { afterEach, describe, expect, test } from "bun:test";

import type { PraxisServerConfig } from "../../env";
import { describeCandidate, resolveResearchTarget } from "../tokenResolve";

const OFFICIAL_TRUMP = "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function config(overrides: Partial<PraxisServerConfig> = {}): PraxisServerConfig {
  return {
    stocksEnabled: true,
    tokens: [{ symbol: "BONK", mint: BONK, decimals: 5, verified: true }],
    ...overrides,
  } as unknown as PraxisServerConfig;
}

function pair(opts: {
  symbol: string;
  address: string;
  name?: string;
  liquidity?: number;
  chainId?: string;
}) {
  return {
    chainId: opts.chainId ?? "solana",
    liquidity: { usd: opts.liquidity ?? 0 },
    baseToken: { symbol: opts.symbol, name: opts.name, address: opts.address },
  };
}

const realFetch = globalThis.fetch;
let calls = 0;

function searchReturning(pairs: unknown[]): typeof globalThis.fetch {
  return (async () => {
    calls += 1;
    return new Response(JSON.stringify({ pairs }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls = 0;
});

describe("a pasted mint resolves without asking anything", () => {
  test("and without the indexer — an address is already the answer", async () => {
    globalThis.fetch = searchReturning([]);
    const resolution = await resolveResearchTarget(OFFICIAL_TRUMP, config());
    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    expect(resolution.via).toBe("mint");
    expect(resolution.token.mint).toBe(OFFICIAL_TRUMP);
    expect(calls).toBe(0);
  });

  /**
   * `normalizeStockAlias` upper-cases every string it does not recognise, so
   * running it before the address check turned "6p6xgHyF…" into "6P6XGHYF…"
   * and failed to resolve it. Base58 is case-sensitive: with stocks enabled,
   * the "try a mint address instead" advice could not be followed.
   */
  test("with stocks enabled, so no alias pass mangles its case", async () => {
    globalThis.fetch = searchReturning([]);
    const resolution = await resolveResearchTarget(OFFICIAL_TRUMP, config({ stocksEnabled: true }));
    expect(resolution.kind === "resolved" && resolution.token.mint).toBe(OFFICIAL_TRUMP);
  });
});

describe("a configured symbol is a decision already made", () => {
  test("the operator's BONK wins over any same-ticker clone", async () => {
    globalThis.fetch = searchReturning([pair({ symbol: "BONK", address: "clone", liquidity: 9e9 })]);
    const resolution = await resolveResearchTarget("bonk", config());
    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    expect(resolution.via).toBe("catalog");
    expect(resolution.token.mint).toBe(BONK);
    expect(calls).toBe(0);
  });
});

describe("an unconfigured ticker goes to the indexer", () => {
  test("one live mint resolves straight through", async () => {
    globalThis.fetch = searchReturning([
      pair({ symbol: "WIF", address: "wifmint", name: "dogwifhat", liquidity: 50_000 }),
    ]);
    const resolution = await resolveResearchTarget("wif", config());
    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    expect(resolution.token.mint).toBe("wifmint");
    expect(resolution.name).toBe("dogwifhat");
  });

  /**
   * The whole point. A ticker is not an identifier on Solana — four live
   * mints answer to TRUMP — so picking the deepest one silently shows the
   * wrong coin's numbers to somebody who will believe them.
   */
  test("several live mints ask, ranked by liquidity, never guessing", async () => {
    globalThis.fetch = searchReturning([
      pair({ symbol: "TRUMP", address: "thin", name: "MAGA", liquidity: 10_000 }),
      pair({ symbol: "TRUMP", address: OFFICIAL_TRUMP, name: "OFFICIAL TRUMP", liquidity: 20_000_000 }),
      pair({ symbol: "TRUMP", address: OFFICIAL_TRUMP, name: "OFFICIAL TRUMP", liquidity: 11_000_000 }),
      pair({ symbol: "TRUMP", address: "middle", name: "OFFER TRUTH", liquidity: 8_000_000 }),
    ]);
    const resolution = await resolveResearchTarget("trump", config());
    expect(resolution.kind).toBe("ambiguous");
    if (resolution.kind !== "ambiguous") return;
    // Liquidity pools across every pair of the same mint, so the two
    // OFFICIAL TRUMP pairs are one candidate worth $31M, not two.
    expect(resolution.candidates.map((c) => c.mint)).toEqual([OFFICIAL_TRUMP, "middle", "thin"]);
    expect(resolution.candidates[0].liquidityUsd).toBe(31_000_000);
  });

  test("other chains and dust pools are not offered as choices", async () => {
    globalThis.fetch = searchReturning([
      pair({ symbol: "PEPE", address: "ethmint", liquidity: 5e8, chainId: "ethereum" }),
      pair({ symbol: "PEPE", address: "real", liquidity: 500_000 }),
      pair({ symbol: "PEPE", address: "dust", liquidity: 4 }),
    ]);
    const resolution = await resolveResearchTarget("pepe", config());
    expect(resolution.kind === "resolved" && resolution.token.mint).toBe("real");
  });

  test("an obscure coin with only a thin pool is still the coin asked for", async () => {
    globalThis.fetch = searchReturning([pair({ symbol: "TINY", address: "tinymint", liquidity: 12 })]);
    const resolution = await resolveResearchTarget("tiny", config());
    expect(resolution.kind === "resolved" && resolution.token.mint).toBe("tinymint");
  });

  test("a name match is the fallback when no ticker matches exactly", async () => {
    globalThis.fetch = searchReturning([
      pair({ symbol: "TRUMP", address: OFFICIAL_TRUMP, name: "OFFICIAL TRUMP", liquidity: 20_000_000 }),
    ]);
    const resolution = await resolveResearchTarget("official trump", config());
    expect(resolution.kind === "resolved" && resolution.token.mint).toBe(OFFICIAL_TRUMP);
  });

  test("nothing found says so, instead of demanding a mint the user doesn't have", async () => {
    globalThis.fetch = searchReturning([]);
    const resolution = await resolveResearchTarget("zzzznotacoin", config());
    expect(resolution).toEqual({ kind: "unknown", query: "zzzznotacoin" });
  });

  test("an indexer outage is an honest 'unknown', not a crashed card", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof globalThis.fetch;
    const resolution = await resolveResearchTarget("wif", config());
    expect(resolution.kind).toBe("unknown");
  });
});

test("a candidate hint carries enough to tell two same-ticker mints apart", () => {
  expect(
    describeCandidate({ symbol: "TRUMP", mint: OFFICIAL_TRUMP, liquidityUsd: 31_900_000 }),
  ).toBe("$31.9M liquidity · 6p6xgH…jfGiPN");
});
