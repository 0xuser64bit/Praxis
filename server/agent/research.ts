import { Connection, PublicKey, type Commitment } from "@solana/web3.js";
import type { ResearchData, ResearchMetric } from "@praxis/shared";

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

  const pairs = indexer.filter((pair) => pair.chainId === "solana");
  const primary = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

  // A pasted mint arrives unnamed. The indexer pairs already fetched above
  // carry the ticker and project name, so the card can say "TRUMP / OFFICIAL
  // TRUMP" instead of the old `mint.slice(0, 6)` guess ("6P6XGH").
  const symbol = token.symbol || primary?.baseToken?.symbol || shortMint(token.mint);
  const name = resolved.name ?? primary?.baseToken?.name;

  const noPairs = "No Solana pair for this mint on the configured indexer.";

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
    summary:
      `Read-only ${symbol} data from Solana RPC and the configured indexer. ` +
      "No buy, sell, or hold recommendation is being made." +
      (stock ? stockSummarySuffix(stock) : ""),
  };
}

const WSOL_MINT = "So11111111111111111111111111111111111111112";

type OnChainStats = {
  /** Raw numeric supply, plus what qualifies it. Formatted by the caller. */
  supply?: { raw: string; note?: string };
  concentrationBps?: bigint;
  /** Whether holder concentration is a meaningful metric for this mint. */
  concentrationApplies: boolean;
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
      return { concentrationApplies: false };
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
  };
}

function errToField(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}

/** "6p6xgH…2jfGiPN" — a last resort when nothing names the mint. */
function shortMint(mint: string): string {
  return `${mint.slice(0, 6)}…${mint.slice(-6)}`;
}

async function fetchIndexerPairs(mint: string, indexerUrl: string | undefined): Promise<DexScreenerPair[]> {
  const url = indexerUrl?.includes("{mint}")
    ? indexerUrl.replace("{mint}", encodeURIComponent(mint))
    : `https://api.dexscreener.com/latest/dex/tokens/${mint}`;

  const res = await fetchWithTimeout(
    url,
    { headers: { accept: "application/json" } },
    {
      ms: envTimeout("PRAXIS_INDEXER_TIMEOUT_MS", 4_000),
      label: "Token indexer lookup",
    },
  );
  if (!res.ok) return [];
  const body = await res.json();
  return Array.isArray(body.pairs) ? body.pairs : [];
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
