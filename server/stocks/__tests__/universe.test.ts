import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { getServerConfig, resetConfigForTests } from "../../env";
import {
  buildStockTokens,
  DEFAULT_STOCK_DECIMALS,
  isStockSymbol,
  normalizeStockAlias,
  STOCK_LIST,
  STOCK_MINT_BY_SYMBOL,
  STOCK_SYMBOLS,
} from "../universe";

const STOCK_ENV_KEYS = [
  "PRAXIS_TOKENS",
  "PRAXIS_STOCKS_ENABLED",
  "PRAXIS_PRESTOCKS_API_URL",
  "PRAXIS_PRESTOCKS_TIMEOUT_MS",
  "PRAXIS_STOCK_UNIVERSE",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(STOCK_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of STOCK_ENV_KEYS) delete process.env[k];
  resetConfigForTests();
});

afterEach(() => {
  for (const k of STOCK_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetConfigForTests();
});

describe("stock universe constants", () => {
  test("ships the 8 PreStocks symbols with spec mints", () => {
    expect(STOCK_SYMBOLS).toEqual([
      "ANDURIL",
      "ANTHROPIC",
      "FIGUREAI",
      "KALSHI",
      "NEURALINK",
      "OPENAI",
      "POLYMARKET",
      "SPACEX",
    ]);
    expect(STOCK_LIST).toHaveLength(8);
    expect(STOCK_MINT_BY_SYMBOL.OPENAI).toBe("PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF");
    expect(STOCK_MINT_BY_SYMBOL.SPACEX).toBe("PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh");
  });
});

describe("normalizeStockAlias", () => {
  test("resolves bare, p-prefixed, cased, and $-prefixed stock phrasing", () => {
    expect(normalizeStockAlias("openai")).toBe("OPENAI");
    expect(normalizeStockAlias("pOpenAI")).toBe("OPENAI");
    expect(normalizeStockAlias("$spacex")).toBe("SPACEX");
    expect(normalizeStockAlias(" polymarket ")).toBe("POLYMARKET");
    // POLYMARKET starts with "p" — the map is explicit (never prefix-stripped),
    // so the canonical symbol always survives normalization intact.
    expect(normalizeStockAlias("POLYMARKET")).toBe("POLYMARKET");
  });

  test("passes non-stock symbols through uppercased (SOL/USDC keep working)", () => {
    expect(normalizeStockAlias("sol")).toBe("SOL");
    expect(normalizeStockAlias("Jup")).toBe("JUP");
  });
});

describe("isStockSymbol", () => {
  test("matches canonical symbols only", () => {
    expect(isStockSymbol("OPENAI")).toBe(true);
    expect(isStockSymbol(" $openai ")).toBe(true);
    expect(isStockSymbol("SOL")).toBe(false);
    expect(isStockSymbol("popenai")).toBe(false);
  });
});

describe("buildStockTokens", () => {
  test("builds 8 verified tokens with provisional decimals by default", () => {
    const tokens = buildStockTokens();
    expect(tokens).toHaveLength(8);
    for (const t of tokens) {
      expect(t.verified).toBe(true);
      expect(t.decimals).toBe(DEFAULT_STOCK_DECIMALS);
    }
  });

  test("honors per-symbol decimal overrides and universe filters", () => {
    const tokens = buildStockTokens({ OPENAI: 9 }, ["OPENAI", "SPACEX"]);
    expect(tokens.map((t) => t.symbol)).toEqual(["OPENAI", "SPACEX"]);
    expect(tokens[0].decimals).toBe(9);
    expect(tokens[1].decimals).toBe(DEFAULT_STOCK_DECIMALS);
  });
});

describe("env stock wiring (flagged)", () => {
  test("flag off: token list is exactly the base list (parity)", () => {
    const config = getServerConfig();
    expect(config.stocksEnabled).toBe(false);
    expect(config.tokens.map((t) => t.symbol)).toEqual(["SOL", "USDC", "JUP", "BONK"]);
  });

  test("flag on: merges the 8 verified stock mints after base tokens", () => {
    process.env.PRAXIS_STOCKS_ENABLED = "1";
    resetConfigForTests();
    const config = getServerConfig();
    expect(config.stocksEnabled).toBe(true);
    expect(config.tokens).toHaveLength(12);
    const openai = config.tokens.find((t) => t.symbol === "OPENAI");
    expect(openai).toMatchObject({
      mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
      verified: true,
    });
    expect(config.prestocksApiUrl).toBe("https://prestocks.com/api/prestocks");
    expect(config.prestocksTimeoutMs).toBe(5000);
  });

  test("universe filter narrows to known symbols; unknown entries are ignored", () => {
    process.env.PRAXIS_STOCKS_ENABLED = "1";
    process.env.PRAXIS_STOCK_UNIVERSE = "openai, spacex, TESSERA, openai";
    resetConfigForTests();
    const config = getServerConfig();
    expect(config.stockUniverse).toEqual(["OPENAI", "SPACEX"]);
    expect(config.tokens.map((t) => t.symbol)).toEqual(["SOL", "USDC", "JUP", "BONK", "OPENAI", "SPACEX"]);
  });

  test("custom PRAXIS_TOKENS plus flag on: no duplicate mints", () => {
    process.env.PRAXIS_STOCKS_ENABLED = "1";
    process.env.PRAXIS_TOKENS = JSON.stringify([
      {
        symbol: "OPENAI",
        mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
        decimals: 9,
        verified: true,
      },
    ]);
    resetConfigForTests();
    const config = getServerConfig();
    const openai = config.tokens.filter((t) => t.symbol === "OPENAI");
    expect(openai).toHaveLength(1);
    expect(openai[0].decimals).toBe(9);
  });
});
