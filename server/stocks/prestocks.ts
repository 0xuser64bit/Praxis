import type { ResearchMetric } from "@praxis/shared";

import { fetchWithTimeout, type FetchLike } from "../api/timeout";

/**
 * PreStocks quote fetcher (Stocklana C03).
 *
 * Read-only, best-effort, never throws to callers: any fetch/parse failure
 * degrades to `[]` so research falls back to the existing RPC + DexScreener
 * path (docs/PRESTOCKS.md §3). Responses are cached 60s in-memory per API URL.
 */

export interface PrestocksEntry {
  symbol: string;
  name: string;
  description: string;
  image: string;
  externalUrl: string;
  mint: string;
  tokenPrice: number;
  markPrice: number;
  markValuation: number;
  impliedValuation: number;
  supply: number;
}

const CACHE_TTL_MS = 60_000;

let cache: { url: string; at: number; entries: PrestocksEntry[] } | undefined;

export function __resetPrestocksCacheForTests() {
  cache = undefined;
}

export async function fetchPrestocksEntries(
  apiUrl: string,
  timeoutMs: number,
  fetchImpl: FetchLike = fetch,
): Promise<PrestocksEntry[]> {
  const now = Date.now();
  if (cache && cache.url === apiUrl && now - cache.at < CACHE_TTL_MS) return cache.entries;

  let entries: PrestocksEntry[] = [];
  try {
    const res = await fetchWithTimeout(
      apiUrl,
      { headers: { accept: "application/json" } },
      { ms: timeoutMs, label: "PreStocks quote lookup" },
      fetchImpl,
    );
    if (res.ok) entries = parsePrestocksBody(await res.json());
  } catch {
    entries = [];
  }

  cache = { url: apiUrl, at: now, entries };
  return entries;
}

export function findPrestocksEntry(entries: PrestocksEntry[], symbol: string): PrestocksEntry | undefined {
  const key = symbol.trim().replace(/^\$/, "").toUpperCase();
  return entries.find((e) => e.symbol === key);
}

/** Loose parser: skips malformed items, never throws on shape drift. */
export function parsePrestocksBody(body: unknown): PrestocksEntry[] {
  if (!Array.isArray(body)) return [];
  const out: PrestocksEntry[] = [];
  for (const item of body) {
    const entry = parsePrestocksEntry(item);
    if (entry) out.push(entry);
  }
  return out;
}

function parsePrestocksEntry(item: unknown): PrestocksEntry | undefined {
  if (!item || typeof item !== "object") return undefined;
  const v = item as Record<string, unknown>;
  const symbol = typeof v.symbol === "string" ? v.symbol.trim().toUpperCase() : "";
  const mint = typeof v.contract_address === "string" ? v.contract_address.trim() : "";
  const tokenPrice = Number(v.tokenPrice);
  const markPrice = Number(v.markPrice);
  if (!symbol || !mint || !Number.isFinite(tokenPrice) || tokenPrice <= 0 || !Number.isFinite(markPrice) || markPrice <= 0) {
    return undefined;
  }
  return {
    symbol,
    name: typeof v.name === "string" ? v.name : `${symbol} PreStocks`,
    description: typeof v.description === "string" ? v.description : "",
    image: typeof v.image === "string" ? v.image : "",
    externalUrl: typeof v.external_url === "string" ? v.external_url : "",
    mint,
    tokenPrice,
    markPrice,
    markValuation: Number(v.markValuation) || 0,
    impliedValuation: Number(v.impliedValuation) || 0,
    supply: Number(v.supply) || 0,
  };
}

/** PreStocks price rows, prepended to the standard research metrics. */
export function stockPriceMetrics(entry: PrestocksEntry): ResearchMetric[] {
  return [
    { label: "Token price (PreStocks)", value: formatPrestocksUsd(entry.tokenPrice), trend: "flat" },
    { label: "Mark price (PreStocks)", value: formatPrestocksUsd(entry.markPrice), trend: "flat" },
  ];
}

export function formatPrestocksSupply(entry: PrestocksEntry): string | undefined {
  if (!Number.isFinite(entry.supply) || entry.supply <= 0) return undefined;
  return `${entry.supply.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${entry.symbol} (PreStocks reported)`;
}

/**
 * Attribution + risk suffix for the research summary. Keeps the existing
 * no-advice sentence; callers append this after it.
 *
 * The issuer-authority line is deliberate. These mints carry Token-2022
 * `PermanentDelegate`, freeze and pause authorities (verified on mainnet
 * 2026-09-20), which means the issuer can move or halt the token regardless
 * of any Aegis policy. Praxis bounds what the *agent* can do with a vault; it
 * cannot bound the issuer of a token someone chose to hold, and a product
 * whose pitch is "limits even a hacked AI can't break" has to be precise
 * about where those limits stop. It is a fact about the asset, not advice.
 */
export function stockSummarySuffix(entry: PrestocksEntry): string {
  const spv = "SPV-backed pre-IPO exposure; may be illiquid.";
  const issuer =
    " The issuer retains freeze, pause and permanent-delegate authority on this mint," +
    " so it can move or halt these tokens independently of your Aegis policy.";
  const link = entry.externalUrl ? ` Details: ${entry.externalUrl}.` : "";
  return ` PreStocks data for ${entry.symbol}: ${spv}${issuer}${link}`;
}

function formatPrestocksUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: value > 0 && value < 1 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
  })}`;
}
