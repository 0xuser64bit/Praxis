import { describe, expect, test } from "bun:test";

import {
  __resetPrestocksCacheForTests,
  fetchPrestocksEntries,
  findPrestocksEntry,
  formatPrestocksSupply,
  parsePrestocksBody,
  stockPriceMetrics,
  stockSummarySuffix,
  type PrestocksEntry,
} from "../prestocks";

const OPENAI_RAW = {
  name: "OpenAI PreStocks",
  symbol: "OPENAI",
  description: " backed 1:1 by SPV exposure ",
  image: "https://www.prestocks.com/logos/openai.png",
  external_url: "https://www.prestocks.com/openai",
  contract_address: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
  markPrice: 976.27,
  markValuation: 1209532255249,
  tokenPrice: 1088.5,
  impliedValuation: 1348581175120,
  supply: 2826.49,
};

function entry(over: Partial<PrestocksEntry> = {}): PrestocksEntry {
  return {
    symbol: "OPENAI",
    name: "OpenAI PreStocks",
    description: "",
    image: "",
    externalUrl: "https://www.prestocks.com/openai",
    mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
    tokenPrice: 1088.5,
    markPrice: 976.27,
    markValuation: 1209532255249,
    impliedValuation: 1348581175120,
    supply: 2826.49,
    ...over,
  };
}

describe("parsePrestocksBody", () => {
  test("parses a live-shaped entry", () => {
    const entries = parsePrestocksBody([OPENAI_RAW]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      symbol: "OPENAI",
      mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
      tokenPrice: 1088.5,
      markPrice: 976.27,
      externalUrl: "https://www.prestocks.com/openai",
    });
  });

  test("never throws on drift: non-arrays and malformed items degrade to skipped", () => {
    expect(parsePrestocksBody({ pairs: [] })).toEqual([]);
    expect(parsePrestocksBody(null)).toEqual([]);
    expect(
      parsePrestocksBody([
        OPENAI_RAW,
        { symbol: "BROKEN" }, // missing mint + prices
        { symbol: "ZERO", contract_address: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", tokenPrice: 0, markPrice: 5 },
        "garbage",
      ]),
    ).toHaveLength(1);
  });
});

describe("findPrestocksEntry", () => {
  test("matches case-insensitively with optional $ prefix", () => {
    const entries = [entry()];
    expect(findPrestocksEntry(entries, "openai")?.mint).toBe(entry().mint);
    expect(findPrestocksEntry(entries, " $OPENAI ")?.mint).toBe(entry().mint);
    expect(findPrestocksEntry(entries, "SOL")).toBeUndefined();
  });
});

describe("stock presentation helpers", () => {
  test("price rows lead with PreStocks-labeled values", () => {
    const metrics = stockPriceMetrics(entry());
    expect(metrics.map((m) => m.label)).toEqual(["Token price (PreStocks)", "Mark price (PreStocks)"]);
    expect(metrics[0].value).toBe("$1,088.50");
    expect(metrics[1].value).toBe("$976.27");
  });

  test("supply fallback is labeled; non-positive supply is undefined", () => {
    expect(formatPrestocksSupply(entry())).toMatch(/2,826\.49 OPENAI \(PreStocks reported\)/);
    expect(formatPrestocksSupply(entry({ supply: 0 }))).toBeUndefined();
  });

  test("summary suffix attributes risk without advice verbs", () => {
    const suffix = stockSummarySuffix(entry());
    expect(suffix).toMatch(/SPV-backed pre-IPO exposure/);
    expect(suffix).toMatch(/https:\/\/www\.prestocks\.com\/openai/);
    expect(suffix).not.toMatch(/buy|sell|hold/i);
  });
});

describe("fetchPrestocksEntries", () => {
  test("network failure degrades to [] (never throws)", async () => {
    __resetPrestocksCacheForTests();
    const boom = async () => {
      throw new Error("network down");
    };
    await expect(fetchPrestocksEntries("https://stocks.invalid/api", 100, boom)).resolves.toEqual([]);
  });

  test("non-OK status degrades to []", async () => {
    __resetPrestocksCacheForTests();
    const fiveHundred = async () => new Response("err", { status: 500 });
    await expect(fetchPrestocksEntries("https://stocks.invalid/api", 100, fiveHundred)).resolves.toEqual(
      [],
    );
  });

  test("success parses and caches per URL (second call does not refetch)", async () => {
    __resetPrestocksCacheForTests();
    let calls = 0;
    const ok = async () => {
      calls++;
      return new Response(JSON.stringify([OPENAI_RAW]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const first = await fetchPrestocksEntries("https://stocks.test/api", 1000, ok);
    const second = await fetchPrestocksEntries("https://stocks.test/api", 1000, ok);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(calls).toBe(1);
    __resetPrestocksCacheForTests();
  });
});
