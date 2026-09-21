/**
 * Which token did the owner mean?
 *
 * Research used to answer this from `config.tokens` alone — the four mints
 * this deployment can also *move*. Everything else dead-ended on
 * `Unknown token "TRUMP". Try a mint address instead.`, which is a demand,
 * not an answer: nobody has the mint to hand, that is what they asked for.
 *
 * Reading is not spending. The transfer catalog is a policy decision about
 * what Aegis will sign; research is a lookup, and it can cover every token
 * the indexer knows without widening what the agent can move by one mint.
 *
 * The catch is that on Solana a ticker is not an identifier. A search for
 * TRUMP returns four live mints, BONK six, PEPE eighteen — so "just take the
 * biggest" silently picks a chart for the wrong coin. When the ticker is
 * genuinely ambiguous the owner picks; when it is not, nothing is asked.
 */

import { PublicKey } from "@solana/web3.js";
import type { TokenInfo } from "@praxis/shared";

import { envTimeout, fetchWithTimeout } from "../api/timeout";
import type { PraxisServerConfig } from "../env";
import { logger } from "../observability/logger";
import { normalizeStockAlias } from "../stocks/universe";

export interface TokenCandidate {
  symbol: string;
  /** Project name from the indexer ("OFFICIAL TRUMP"), when it has one. */
  name?: string;
  mint: string;
  /** Pooled liquidity across every pair, the only honest ranking signal. */
  liquidityUsd: number;
  priceUsd?: string;
}

export type TokenResolution =
  /** One token, no question asked. */
  | {
      kind: "resolved";
      token: TokenInfo;
      via: "mint" | "catalog" | "search";
      name?: string;
      /** Other mints sharing the ticker — shown as a footnote, not a prompt. */
      alternatives: TokenCandidate[];
    }
  /** Several live mints share this ticker; the owner picks. */
  | { kind: "ambiguous"; query: string; candidates: TokenCandidate[] }
  /** The indexer knows nothing by this name. */
  | { kind: "unknown"; query: string };

/**
 * DexScreener's search endpoint, which is also what the per-mint lookup in
 * `research.ts` already uses. Hardcoded rather than env-driven: the per-mint
 * `PRAXIS_INDEXER_URL` knob exists because operators point that at their own
 * cache, and no one has asked for the same over search.
 */
const SEARCH_URL = "https://api.dexscreener.com/latest/dex/search?q=";

/** Below this, a "pair" is a dust pool that would only pad the picker. */
const DUST_LIQUIDITY_USD = 1_000;

/** More than a handful of choices is a list, not a question. */
const MAX_CANDIDATES = 5;

export async function resolveResearchTarget(
  input: string,
  config: PraxisServerConfig,
): Promise<TokenResolution> {
  const trimmed = input.trim().replace(/^\$/, "");
  if (!trimmed) return { kind: "unknown", query: input };

  // 1. A pasted mint is already the answer, and it is checked FIRST because
  //    base58 is case-sensitive and `normalizeStockAlias` upper-cases every
  //    string it does not recognise. Running it first turned a pasted mint
  //    into "6P6XGHYF7…" and then failed to resolve it — which is to say the
  //    "try a mint address instead" advice did not work either.
  //
  //    The symbol is left blank on purpose: `research.ts` names it from the
  //    indexer pairs it fetches anyway, which beats `mint.slice(0, 6)`.
  const mint = asMint(trimmed);
  if (mint) {
    return {
      kind: "resolved",
      token: { symbol: "", mint, decimals: 0, verified: false },
      via: "mint",
      alternatives: [],
    };
  }

  // 2. `popenai` / `pSpaceX` fold into the canonical stock symbol, exactly as
  //    they do on the transfer path. A symbol this deployment configured is a
  //    decision already made — "BONK" here means the operator's BONK, never a
  //    same-ticker clone.
  const query = config.stocksEnabled ? normalizeStockAlias(trimmed) : trimmed;
  const configured = config.tokens.find(
    (token) => token.symbol.toUpperCase() === query.toUpperCase(),
  );
  if (configured) {
    return { kind: "resolved", token: configured, via: "catalog", alternatives: [] };
  }

  // 3. Anything else: ask the indexer what trades under that name. Searching
  //    and reporting both use the text as typed — the alias pass upper-cases
  //    what it doesn't know, and "no token called ZZZZNOTACOIN" shouts back
  //    a word the owner never wrote.
  const candidates = await searchCandidates(trimmed);
  if (candidates.length === 0) return { kind: "unknown", query: trimmed };
  if (candidates.length > 1) return { kind: "ambiguous", query: trimmed, candidates };

  const [only] = candidates;
  return {
    kind: "resolved",
    token: { symbol: only.symbol, mint: only.mint, decimals: 0, verified: false },
    via: "search",
    name: only.name,
    alternatives: [],
  };
}

/** A valid 32-byte base58 key, or null. */
function asMint(value: string): string | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return null;
  try {
    return new PublicKey(value).toBase58();
  } catch {
    return null;
  }
}

interface SearchPair {
  chainId?: string;
  priceUsd?: string;
  liquidity?: { usd?: number };
  baseToken?: { symbol?: string; name?: string; address?: string };
}

/**
 * Solana mints trading under `query`, deepest liquidity first.
 *
 * Exact ticker matches win outright; a name match is the fallback so
 * "official trump" finds something rather than nothing. Dust pools are
 * dropped unless dropping them would leave nothing at all — an obscure coin
 * with one thin pool is still the coin that was asked for.
 */
async function searchCandidates(query: string): Promise<TokenCandidate[]> {
  let pairs: SearchPair[];
  try {
    const res = await fetchWithTimeout(
      `${SEARCH_URL}${encodeURIComponent(query)}`,
      { headers: { accept: "application/json" } },
      { ms: envTimeout("PRAXIS_INDEXER_TIMEOUT_MS", 4_000), label: "Token symbol search" },
    );
    if (!res.ok) {
      logger.warn("research.search_failed", { query, status: res.status });
      return [];
    }
    const body = await res.json();
    pairs = Array.isArray(body?.pairs) ? body.pairs : [];
  } catch (error) {
    logger.warn("research.search_unavailable", {
      query,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const byMint = new Map<string, TokenCandidate>();
  for (const pair of pairs) {
    if (pair.chainId !== "solana") continue;
    const address = pair.baseToken?.address;
    const symbol = pair.baseToken?.symbol;
    if (!address || !symbol) continue;

    const existing = byMint.get(address);
    const candidate: TokenCandidate = existing ?? {
      symbol,
      name: pair.baseToken?.name,
      mint: address,
      liquidityUsd: 0,
      priceUsd: pair.priceUsd,
    };
    // Liquidity is pooled across pairs; the price quoted is the deepest pair's.
    if (!existing || (pair.liquidity?.usd ?? 0) > 0) candidate.priceUsd ??= pair.priceUsd;
    candidate.liquidityUsd += pair.liquidity?.usd ?? 0;
    byMint.set(address, candidate);
  }

  const all = [...byMint.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  const exact = all.filter((c) => c.symbol.toUpperCase() === query.toUpperCase());
  const matched = exact.length > 0
    ? exact
    : all.filter((c) => c.name?.toLowerCase().includes(query.toLowerCase()));

  const liquid = matched.filter((c) => c.liquidityUsd >= DUST_LIQUIDITY_USD);
  return (liquid.length > 0 ? liquid : matched).slice(0, MAX_CANDIDATES);
}

/** "$31.7M liquidity · 6p6xgH…2jfGiPN" — enough to tell two TRUMPs apart. */
export function describeCandidate(candidate: TokenCandidate): string {
  const liquidity = candidate.liquidityUsd > 0
    ? `${compactUsd(candidate.liquidityUsd)} liquidity`
    : "no pooled liquidity";
  return `${liquidity} · ${candidate.mint.slice(0, 6)}…${candidate.mint.slice(-6)}`;
}

function compactUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })}`;
}
