import { Connection, PublicKey, type Commitment } from "@solana/web3.js";
import type { ResearchData, ResearchMetric, ResearchSource } from "@praxis/shared";

import type { PraxisServerConfig } from "../env";
import { envTimeout, fetchWithTimeout, withTimeout } from "../api/timeout";
import { logger } from "../observability/logger";
import { formatBps } from "../units";
import { compactAmount, compactUsd, formatPrice } from "./researchFormat";
import {
  fetchPrestocksEntries,
  findPrestocksEntry,
  formatPrestocksSupply,
  stockPriceMetrics,
  stockSummarySuffix,
  type PrestocksEntry,
} from "../stocks/prestocks";
import { isStockSymbol } from "../stocks/universe";
import type { TokenResolution } from "./tokenResolve";

type ResolvedToken = Extract<TokenResolution, { kind: "resolved" }>;

interface DexScreenerPair {
  chainId?: string;
  priceUsd?: string;
  volume?: { h24?: number; h6?: number; h1?: number };
  liquidity?: { usd?: number };
  priceChange?: { h24?: number };
  fdv?: number;
  marketCap?: number;
  dexId?: string;
  baseToken?: { symbol?: string; name?: string; address?: string };
  quoteToken?: { symbol?: string; address?: string };
}

export async function researchToken(
  resolved: ResolvedToken,
  connection: Connection,
  config: PraxisServerConfig,
): Promise<ResearchData> {
  const token = resolved.token;
  const mint = new PublicKey(token.mint);
  const rpcTimeout = envTimeout("PRAXIS_RPC_READ_TIMEOUT_MS", 8_000);
  const wantStock = config.stocksEnabled && isStockSymbol(token.symbol);
  const [chain, indexer, stock] = await Promise.all([
    fetchOnChainStats(connection, mint, config.commitment, rpcTimeout, token.symbol),
    fetchIndexerPairs(token.mint, config.indexerUrl),
    wantStock
      ? fetchPrestocksEntries(config.prestocksApiUrl, config.prestocksTimeoutMs).then((entries) =>
          findPrestocksEntry(entries, token.symbol),
        )
      : Promise.resolve(undefined as PrestocksEntry | undefined),
  ]);

  const pairs = indexer.pairs.filter((pair) => pair.chainId === "solana");
  const primary = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

  // A pasted mint arrives unnamed. The indexer pairs already fetched above
  // carry the ticker and project name, so the card can say "TRUMP / OFFICIAL
  // TRUMP" instead of the old `mint.slice(0, 6)` guess ("6P6XGH").
  const symbol = token.symbol || primary?.baseToken?.symbol || shortMint(token.mint);
  const name = resolved.name ?? primary?.baseToken?.name;

  const noPairs = indexer.error
    ? `The market-data lookup failed${reason(indexer.error)}.`
    : "No Solana pair for this mint on the configured indexer.";

  // Stocklana C03: PreStocks rows lead for stocks; everything below keeps the
  // existing RPC + indexer behavior (including honest "unavailable").
  const metrics: ResearchMetric[] = [
    ...(stock ? stockPriceMetrics(stock) : []),
    {
      label: "Price",
      ...(primary?.priceUsd ? formatPrice(primary.priceUsd) : { value: "unavailable", note: noPairs }),
    },
    {
      label: "24h change",
      value: primary?.priceChange?.h24 === undefined ? "unavailable" : `${formatSigned(primary.priceChange.h24)}%`,
      trend: trend(primary?.priceChange?.h24),
      ...(primary?.priceChange?.h24 === undefined ? { note: noPairs } : {}),
    },
    {
      label: "24h volume",
      // Volume alone is a level, not a direction — leave trend flat unless we have a delta.
      ...(primary?.volume?.h24 === undefined
        ? { value: "unavailable", note: noPairs }
        : compactUsd(primary.volume.h24)),
      trend: "flat",
    },
  ];

  // Holder concentration is an SPL-token notion; native SOL has no clean RPC
  // source, so the row is shown only when it actually applies to this mint.
  if (chain.concentrationApplies) {
    metrics.push({
      label: "Top 10 concentration",
      value: chain.concentrationBps === undefined ? "unavailable" : formatBps(chain.concentrationBps),
      trend: "flat",
      note: chain.concentrationBps === undefined
        ? CONCENTRATION_UNAVAILABLE
        : CONCENTRATION_MEANING,
    });
  }

  // Stocklana C03: when on-chain supply is unavailable for a stock, fall back
  // to the PreStocks-reported figure — labeled as such, never silently.
  const supply = chain.supply
    ? { ...compactAmount(chain.supply.raw), note: chain.supply.note }
    : stock
      ? formatPrestocksSupply(stock)
      : undefined;
  metrics.push({
    label: "Supply",
    value: "unavailable",
    note: "The research RPC did not return this mint's supply.",
    ...supply,
    trend: "flat",
  });

  if (primary?.marketCap || primary?.fdv) {
    metrics.push({
      label: primary.marketCap ? "Market cap" : "FDV",
      ...compactUsd(primary.marketCap ?? primary.fdv ?? 0),
      trend: "flat",
    });
  }

  return {
    token: symbol,
    name: name && name.toUpperCase() !== symbol.toUpperCase() ? name : undefined,
    mint: token.mint,
    metrics,
    sources: buildSources({ resolved, symbol, chain, pairs, primary, stock, config, indexerError: indexer.error }),
    summary:
      `Read-only ${symbol} data from Solana RPC and the configured indexer. ` +
      "No buy, sell, or hold recommendation is being made." +
      (stock ? stockSummarySuffix(stock) : ""),
  };
}

/**
 * How the card was produced, step by step.
 *
 * A read-only card whose whole pitch is "data, no advice" has to be able to
 * show its working. Until now every gap looked identical — one word,
 * "unavailable" — whether the indexer had no pair for the mint, the RPC
 * refused the query, or the metric does not apply to this token at all.
 * Those are three different facts, and only one of them is worth retrying.
 *
 * The resolution step leads, because on a chain where four live mints answer
 * to TRUMP, "which token is this card about, and how did we decide" is the
 * first thing a reader needs to be able to check.
 */
function buildSources(input: {
  resolved: ResolvedToken;
  symbol: string;
  chain: OnChainStats;
  pairs: DexScreenerPair[];
  primary: DexScreenerPair | undefined;
  stock: PrestocksEntry | undefined;
  config: PraxisServerConfig;
  indexerError?: string;
}): ResearchSource[] {
  const { resolved, symbol, chain, pairs, primary, stock, config, indexerError } = input;

  const resolution: Record<ResolvedToken["via"], string> = {
    mint: `You pasted the mint address, so no lookup was needed — ${shortMint(resolved.token.mint)}.`,
    catalog: `${symbol} is in this deployment's configured token list, which wins over any same-ticker mint.`,
    search: `${symbol} matched one Solana mint on the indexer's symbol search — ${shortMint(resolved.token.mint)}.`,
  };
  const sources: ResearchSource[] = [
    { label: "Token resolution", status: "ok", detail: resolution[resolved.via] },
  ];

  const rpc = hostOf(config.researchRpcUrl);
  const rpcDetail = [
    chain.supply ? "Supply read from the mint." : `Supply unavailable${reason(chain.supplyError)}.`,
    chain.concentrationApplies
      ? chain.concentrationBps !== undefined
        ? "Top 10 holder accounts read."
        : `Holder accounts unavailable${reason(chain.holdersError)} — the public ` +
          "Solana endpoint rate-limits this call hard; a provider RPC returns it."
      : "Holder concentration does not apply to native SOL.",
  ].join(" ");
  sources.push({
    label: `Solana RPC (${rpc})`,
    status: chain.supply && (chain.concentrationBps !== undefined || !chain.concentrationApplies)
      ? "ok"
      : chain.supply
        ? "partial"
        : "unavailable",
    detail: rpcDetail,
  });

  sources.push({
    label: `Market data (${hostOf(config.indexerUrl ?? "https://api.dexscreener.com")})`,
    status: primary ? "ok" : "unavailable",
    detail: primary
      ? `${pairs.length} Solana pair${pairs.length === 1 ? "" : "s"}; price, 24h change, volume and ` +
        `market cap come from the deepest one (${primary.dexId ?? "unknown dex"}, ` +
        `${primary.baseToken?.symbol ?? symbol}/${primary.quoteToken?.symbol ?? "?"}).`
      : indexerError
        // An outage and "this mint has no market" are not the same answer:
        // one is worth trying again in a minute, the other never will be.
        ? `The lookup did not complete${reason(indexerError)}, so there is no market price on this card.`
        : "No Solana pair found for this mint, so there is no market price to report.",
  });

  if (config.stocksEnabled && isStockSymbol(symbol)) {
    sources.push({
      label: "PreStocks",
      status: stock ? "ok" : "unavailable",
      detail: stock
        ? "Token and mark price, and the supply fallback, come from the PreStocks quote feed."
        : "The PreStocks quote feed did not return a row for this symbol.",
    });
  }

  return sources;
}

/** Host only — a provider RPC URL can carry an API key in its query string. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "configured endpoint";
  }
}

/**
 * Turn an RPC failure into something a reader can act on. Falls through to
 * the raw message rather than an empty parenthesis: an unrecognised error is
 * still more use than "unavailable" on its own — that is the whole point of
 * the trail.
 */
function reason(error: string | undefined): string {
  if (!error) return "";
  if (/429|too many requests|rate limit/i.test(error)) return " (the endpoint rate-limited this call)";
  if (/timed out/i.test(error)) return " (no answer before the read timeout)";
  if (/could not find account|account does not exist/i.test(error)) {
    return " (this mint is not on the cluster the research RPC points at)";
  }
  return ` (${error.replace(/\s+/g, " ").trim().slice(0, 90)})`;
}

const WSOL_MINT = "So11111111111111111111111111111111111111112";

type OnChainStats = {
  /** Raw numeric supply, plus what qualifies it. Formatted by the caller. */
  supply?: { raw: string; note?: string };
  concentrationBps?: bigint;
  /** Whether holder concentration is a meaningful metric for this mint. */
  concentrationApplies: boolean;
  /** Why a half of the read is missing — shown in the card's source trail. */
  supplyError?: string;
  holdersError?: string;
};

/**
 * What the row measures, for the reader who has not met the metric before —
 * it is a rug-risk signal, not a price signal.
 */
const CONCENTRATION_MEANING =
  "Share of supply held by the ten largest token accounts — a concentration " +
  "signal: the higher it is, the fewer wallets it takes to move the price.";

/**
 * Why the row is so often empty, which was the actual question.
 *
 * `getTokenLargestAccounts` is one of the calls the public Solana RPC
 * (api.mainnet-beta.solana.com, the default here) rate-limits hardest: it
 * answers 429 "Too many requests for a specific RPC call" more or less
 * always, while `getTokenSupply` on the very same mint succeeds. So the row
 * reads "unavailable" on every deployment that never set
 * PRAXIS_RESEARCH_RPC_URL — which looks like a broken feature and is really
 * an unset endpoint.
 */
const CONCENTRATION_UNAVAILABLE =
  CONCENTRATION_MEANING +
  " Unavailable: the research RPC refused the holder-accounts query, which " +
  "the public Solana endpoint rate-limits hard. A provider RPC returns it.";

/**
 * On-chain supply + holder concentration are best-effort and resilient:
 *  - Native SOL (wrapped-SOL mint) reports real circulating supply via
 *    getSupply, and skips holder concentration (no clean RPC source; wrapped-SOL
 *    accounts are meaningless as "SOL holders").
 *  - SPL tokens fetch supply and largest accounts INDEPENDENTLY, so a failing
 *    getTokenLargestAccounts (public RPCs commonly rate-limit it) no longer
 *    blanks out the supply figure too.
 * Anything that fails degrades to "unavailable" without failing the whole card.
 */
async function fetchOnChainStats(
  connection: Connection,
  mint: PublicKey,
  commitment: Commitment,
  timeoutMs: number,
  symbol: string,
): Promise<OnChainStats> {
  if (mint.toBase58() === WSOL_MINT) {
    try {
      const supply = await withTimeout(
        connection.getSupply({ commitment, excludeNonCirculatingAccountsList: true }),
        timeoutMs,
        "Solana native supply lookup",
      );
      const circulatingSol = Number(supply.value.circulating) / 1e9;
      return {
        supply: {
          raw: circulatingSol.toFixed(2),
          note: "Circulating SOL, excluding known non-circulating accounts.",
        },
        concentrationApplies: false,
      };
    } catch (error) {
      logger.warn("research.onchain_unavailable", { symbol, mint: WSOL_MINT, ...errToField(error) });
      return { concentrationApplies: false, supplyError: errToField(error).error };
    }
  }

  const [supplyResult, largestResult] = await Promise.allSettled([
    withTimeout(connection.getTokenSupply(mint, commitment), timeoutMs, "Solana token supply lookup"),
    withTimeout(connection.getTokenLargestAccounts(mint, commitment), timeoutMs, "Solana largest token accounts lookup"),
  ]);

  if (supplyResult.status === "rejected") {
    logger.warn("research.supply_unavailable", { symbol, mint: mint.toBase58(), ...errToField(supplyResult.reason) });
  }
  if (largestResult.status === "rejected") {
    logger.warn("research.holders_unavailable", { symbol, mint: mint.toBase58(), ...errToField(largestResult.reason) });
  }

  const supply = supplyResult.status === "fulfilled" ? supplyResult.value : undefined;
  const concentrationBps =
    supply && largestResult.status === "fulfilled"
      ? topHolderBps(
          largestResult.value.value.map((account) => BigInt(account.amount)),
          BigInt(supply.value.amount),
        )
      : undefined;

  return {
    supply: supply ? { raw: supply.value.uiAmountString ?? supply.value.amount } : undefined,
    concentrationBps,
    concentrationApplies: true,
    ...(supplyResult.status === "rejected" ? { supplyError: errToField(supplyResult.reason).error } : {}),
    ...(largestResult.status === "rejected" ? { holdersError: errToField(largestResult.reason).error } : {}),
  };
}

function errToField(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}

/** "6p6xgH…2jfGiPN" — a last resort when nothing names the mint. */
function shortMint(mint: string): string {
  return `${mint.slice(0, 6)}…${mint.slice(-6)}`;
}

/**
 * Market pairs for a mint, best-effort.
 *
 * A non-2xx already degraded to `[]`, but a timeout or a DNS failure threw —
 * and that throw escaped all the way to the chat reply, so an indexer hiccup
 * replaced the whole card (including the on-chain data that *did* load) with
 * "Token indexer lookup timed out after 4000ms". Every other read here
 * degrades; this one now does too, and the source trail says which.
 */
async function fetchIndexerPairs(
  mint: string,
  indexerUrl: string | undefined,
): Promise<{ pairs: DexScreenerPair[]; error?: string }> {
  const url = indexerUrl?.includes("{mint}")
    ? indexerUrl.replace("{mint}", encodeURIComponent(mint))
    : `https://api.dexscreener.com/latest/dex/tokens/${mint}`;

  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { accept: "application/json" } },
      {
        ms: envTimeout("PRAXIS_INDEXER_TIMEOUT_MS", 4_000),
        label: "Token indexer lookup",
      },
    );
    if (!res.ok) {
      logger.warn("research.indexer_status", { mint, status: res.status });
      return { pairs: [], error: `the indexer answered ${res.status}` };
    }
    const body = await res.json();
    return { pairs: Array.isArray(body.pairs) ? body.pairs : [] };
  } catch (error) {
    logger.warn("research.indexer_unavailable", { mint, ...errToField(error) });
    return { pairs: [], error: errToField(error).error };
  }
}

function topHolderBps(amounts: bigint[], supply: bigint): bigint | undefined {
  if (supply <= 0n) return undefined;
  const top10 = amounts.slice(0, 10).reduce((sum, amount) => sum + amount, 0n);
  return (top10 * 10_000n) / supply;
}

function formatSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

function trend(value: number | undefined): "up" | "down" | "flat" {
  if (value === undefined || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}
