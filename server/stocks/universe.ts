import type { TokenInfo } from "@praxis/shared";

/**
 * PreStocks stock universe (Stocklana C02).
 *
 * Source of truth for the 8 pre-IPO mints in docs/PRESTOCKS.md §1, verified by
 * `bun run praxis:stockscheck` (see docs/PRESTOCKS-SPIKE.md). Pure module —
 * no `process.env` reads here, so intent/research code stays unit-testable.
 * Env wiring lives in `server/env.ts`.
 *
 * Bounty exclusivity (binding): only PreStocks pre-IPO mints may appear here.
 * Never add a non-PreStocks pre-IPO mint in the submission branch.
 */

export interface StockEntry {
  symbol: string;
  name: string;
  mint: string;
}

export const STOCK_LIST: StockEntry[] = [
  { symbol: "ANDURIL", name: "Anduril PreStocks", mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB" },
  { symbol: "ANTHROPIC", name: "Anthropic PreStocks", mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw" },
  { symbol: "FIGUREAI", name: "Figure AI PreStocks", mint: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd" },
  { symbol: "KALSHI", name: "Kalshi PreStocks", mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua" },
  { symbol: "NEURALINK", name: "Neuralink PreStocks", mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S" },
  { symbol: "OPENAI", name: "OpenAI PreStocks", mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF" },
  { symbol: "POLYMARKET", name: "Polymarket PreStocks", mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP" },
  { symbol: "SPACEX", name: "SpaceX PreStocks", mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh" },
];

/**
 * Verified scale for the PreStocks mints: **9**, not the 6 this shipped with.
 *
 * The PreStocks API does not report decimals and the spike left it an open
 * question, so the universe filled in 6 — and that value reached
 * `parseHumanUnits`, the token-envelope cap defaults, and every amount the UI
 * rendered. It was wrong by three orders of magnitude: "buy 40 OPENAI" parsed
 * at 6dp is 40,000,000 base units, which on a 9dp mint is 0.04 OPENAI, and a
 * "200 per-tx cap" was really 0.2.
 *
 * Read from mainnet on 2026-09-20 — every one of the eight mints reports
 * `decimals = 9` at byte 44 of its mint account. Still treated as a default
 * rather than gospel: amount math resolves the live value through
 * `resolveMintDecimals` and refuses when it cannot confirm one, so a future
 * mint added here with the wrong constant cannot quietly move the wrong
 * quantity.
 */
export const DEFAULT_STOCK_DECIMALS = 9;

/**
 * The SPL program that owns the PreStocks mints: **Token-2022**, not classic
 * SPL Token. Verified on mainnet 2026-09-20 (mint accounts are 902-914 bytes,
 * owner `TokenzQd…`). This is what makes them unmovable by the deployed Aegis
 * program — see `assertAegisTransferableMint`.
 */
export const STOCK_TOKEN_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/**
 * True when this token's `decimals` came from the default above rather than a
 * confirmed lookup or an operator override. Callers doing amount math must
 * resolve the real scale first and refuse the action if they cannot.
 */
export function hasProvisionalDecimals(symbol: string, overrides: Record<string, number> = {}): boolean {
  const normalized = symbol.trim().replace(/^\$/, "").toUpperCase();
  return isStockSymbol(normalized) && overrides[normalized] === undefined;
}

export const STOCK_SYMBOLS: string[] = STOCK_LIST.map((s) => s.symbol);

export const STOCK_MINT_BY_SYMBOL: Record<string, string> = Object.fromEntries(
  STOCK_LIST.map((s) => [s.symbol, s.mint]),
);

/**
 * Explicit alias map (lowercase, `$`-stripped) → canonical symbol.
 * Deliberately explicit — never prefix-strip: `POLYMARKET` starts with "p",
 * so a naive leading-`p` strip would corrupt it.
 */
const STOCK_ALIASES: Record<string, string> = Object.fromEntries(
  STOCK_LIST.flatMap((s) => {
    const lower = s.symbol.toLowerCase();
    return [
      [lower, s.symbol],
      [`p${lower}`, s.symbol],
    ];
  }),
);

export function isStockSymbol(value: string): boolean {
  return STOCK_SYMBOLS.includes(value.trim().replace(/^\$/, "").toUpperCase());
}

/**
 * Map user phrasing to a canonical symbol. Stock aliases resolve exactly;
 * anything else passes through uppercased so SOL/USDC-style symbols keep
 * working (e.g. `"sol"` → `"SOL"`, `"Jup"` → `"JUP"`).
 */
export function normalizeStockAlias(input: string): string {
  const key = input.trim().replace(/^\$/, "").toLowerCase();
  return STOCK_ALIASES[key] ?? key.toUpperCase();
}

/**
 * Build `TokenInfo[]` for the stock universe. `decimals` overrides per symbol
 * (used once the RPC spike confirms real values); `universe` restricts to a
 * subset of symbols (mirrors `PRAXIS_STOCK_UNIVERSE`, `undefined` = all).
 */
export function buildStockTokens(
  decimals: Record<string, number> = {},
  universe: string[] | undefined = undefined,
): TokenInfo[] {
  return STOCK_LIST.filter((s) => !universe || universe.includes(s.symbol)).map((s) => ({
    symbol: s.symbol,
    mint: s.mint,
    decimals: decimals[s.symbol] ?? DEFAULT_STOCK_DECIMALS,
    verified: true,
  }));
}
