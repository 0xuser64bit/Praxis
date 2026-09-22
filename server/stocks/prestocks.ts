import type { ResearchMetric } from "@praxis/shared";

import { fetchWithTimeout, type FetchLike } from "../api/timeout";
import { errorFields, logger } from "../observability/logger";
import { compactAmount } from "../agent/researchFormat";
import {
  cleanText,
  MAX_DETAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SYMBOL_LENGTH,
} from "../agent/untrusted";

/**
 * PreStocks quote fetcher (Stocklana C03).
 *
 * Read-only and best-effort: it never throws to callers, because research
 * falls back to the RPC + DexScreener path and a basket refuses itself rather
 * than guessing (docs/PRESTOCKS.md §3). A successful response is cached 60s
 * per API URL; a FAILED refresh serves the last good answer for a short grace
 * period instead of caching "no prices" (see STALE_GRACE_MS). Concurrent
 * callers share one in-flight request.
 *
 * Everything the feed returns is treated as third-party text: symbols and
 * names are bounded, the contract address is validated as a real key, and the
 * external URL must be http(s) before it is quoted into agent copy.
 */

/**
 * The fields of a PreStocks quote that Praxis actually uses. The feed returns
 * more (contract address, description, logo, valuations); carrying them meant
 * validating and storing third-party strings nothing ever read.
 *
 * The contract address in particular is NOT the mint Praxis transfers: that
 * comes from the configured universe, which a devnet deploy remaps to mirror
 * mints. Taking it from the price feed would be a quote source deciding which
 * token moves.
 */
export interface PrestocksEntry {
  symbol: string;
  name: string;
  /** Linked from the research summary; http(s) only. */
  externalUrl: string;
  tokenPrice: number;
  markPrice: number;
  supply: number;
}

const CACHE_TTL_MS = 60_000;
/**
 * How long a *failed* refresh may keep serving the last good answer.
 *
 * The old cache stored the empty result of a failed fetch for the full TTL,
 * which meant one network blip removed every price for a minute — and a
 * basket buy is all-or-clarify, so for that minute every basket in the
 * product was refused with "PreStocks quotes unavailable". Serving a
 * few-minute-old mark instead is both more useful and more honest: these are
 * pre-IPO marks, the figure is shown on the card, and nothing moves until the
 * owner signs it. Past the grace period there is no answer rather than a
 * stale one.
 */
const STALE_GRACE_MS = 5 * 60_000;

interface CacheState {
  url: string;
  /** When the entries were last successfully refreshed. */
  freshAt: number;
  entries: PrestocksEntry[];
}

let cache: CacheState | undefined;
/** In-flight refresh, so N concurrent callers make one request, not N. */
let inflight: { url: string; work: Promise<PrestocksEntry[]> } | undefined;

export function __resetPrestocksCacheForTests() {
  cache = undefined;
  inflight = undefined;
}

/**
 * Test seam: age the cache past its TTL but keep it inside the stale grace
 * window, i.e. "due for a refresh, still usable if that refresh fails".
 */
export function __expirePrestocksCacheForTests() {
  if (cache) cache.freshAt = Date.now() - CACHE_TTL_MS - 1;
}

export async function fetchPrestocksEntries(
  apiUrl: string,
  timeoutMs: number,
  fetchImpl: FetchLike = fetch,
): Promise<PrestocksEntry[]> {
  const now = Date.now();
  if (cache && cache.url === apiUrl && now - cache.freshAt < CACHE_TTL_MS) return cache.entries;
  if (inflight && inflight.url === apiUrl) return inflight.work;

  const work = refresh(apiUrl, timeoutMs, fetchImpl).finally(() => {
    if (inflight?.work === work) inflight = undefined;
  });
  inflight = { url: apiUrl, work };
  return work;
}

async function refresh(
  apiUrl: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<PrestocksEntry[]> {
  try {
    const res = await fetchWithTimeout(
      apiUrl,
      { headers: { accept: "application/json" } },
      { ms: timeoutMs, label: "PreStocks quote lookup" },
      fetchImpl,
    );
    if (!res.ok) throw new Error(`PreStocks quote feed answered ${res.status}`);
    // An empty-but-valid body is an answer, and is cached as one — retrying it
    // on every call would hammer the provider for the same nothing.
    const entries = parsePrestocksBody(await res.json());
    cache = { url: apiUrl, freshAt: Date.now(), entries };
    return entries;
  } catch (error) {
    logger.warn("prestocks.refresh_failed", errorFields(error));
    const stale = cache && cache.url === apiUrl && Date.now() - cache.freshAt < STALE_GRACE_MS;
    return stale ? cache!.entries : [];
  }
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
  const symbol = cleanText(v.symbol, MAX_SYMBOL_LENGTH)?.toUpperCase();
  const tokenPrice = Number(v.tokenPrice);
  const markPrice = Number(v.markPrice);
  if (!symbol || !Number.isFinite(tokenPrice) || tokenPrice <= 0 || !Number.isFinite(markPrice) || markPrice <= 0) {
    return undefined;
  }
  const supply = Number(v.supply);
  return {
    symbol,
    name: cleanText(v.name, MAX_NAME_LENGTH) ?? `${symbol} PreStocks`,
    // This reaches agent copy (the research summary links it), so an unbounded
    // or non-http value would be quoting a third party into the product's own
    // sentence.
    externalUrl: httpUrl(v.external_url) ?? "",
    tokenPrice,
    markPrice,
    supply: Number.isFinite(supply) ? supply : 0,
  };
}

/** An http(s) URL, bounded, or undefined — never `javascript:` or a novel. */
function httpUrl(value: unknown): string | undefined {
  const text = cleanText(value, MAX_DETAIL_LENGTH);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** PreStocks price rows, prepended to the standard research metrics. */
export function stockPriceMetrics(entry: PrestocksEntry): ResearchMetric[] {
  return [
    { label: "Token price (PreStocks)", value: formatPrestocksUsd(entry.tokenPrice), trend: "flat" },
    { label: "Mark price (PreStocks)", value: formatPrestocksUsd(entry.markPrice), trend: "flat" },
  ];
}

export function formatPrestocksSupply(entry: PrestocksEntry): ResearchMetric | undefined {
  if (!Number.isFinite(entry.supply) || entry.supply <= 0) return undefined;
  const { value, exact } = compactAmount(entry.supply.toFixed(2));
  return {
    label: "Supply",
    value: `${value} ${entry.symbol}`,
    ...(exact ? { exact: `${exact} ${entry.symbol}` } : {}),
    note: "Reported by PreStocks, not read from the mint on-chain.",
  };
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
