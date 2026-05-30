import { Connection, PublicKey } from "@solana/web3.js";
import type { ResearchData, ResearchMetric, TokenInfo } from "@praxis/shared";

import type { PraxisServerConfig } from "../env";
import { envTimeout, fetchWithTimeout, withTimeout } from "../api/timeout";
import { formatBps } from "../units";

interface DexScreenerPair {
  chainId?: string;
  priceUsd?: string;
  volume?: { h24?: number; h6?: number; h1?: number };
  liquidity?: { usd?: number };
  priceChange?: { h24?: number };
  fdv?: number;
  marketCap?: number;
  dexId?: string;
  baseToken?: { symbol?: string; address?: string };
  quoteToken?: { symbol?: string; address?: string };
}

export async function researchToken(
  tokenInput: string,
  connection: Connection,
  config: PraxisServerConfig,
): Promise<ResearchData> {
  const token = resolveToken(tokenInput, config.tokens);
  const mint = new PublicKey(token.mint);
  const rpcTimeout = envTimeout("PRAXIS_RPC_READ_TIMEOUT_MS", 8_000);
  const [largest, supply, indexer] = await Promise.all([
    withTimeout(
      connection.getTokenLargestAccounts(mint, config.commitment),
      rpcTimeout,
      "Solana largest token accounts lookup",
    ),
    withTimeout(
      connection.getTokenSupply(mint, config.commitment),
      rpcTimeout,
      "Solana token supply lookup",
    ),
    fetchIndexerPairs(token.mint, config.indexerUrl),
  ]);

  const pairs = indexer.filter((pair) => pair.chainId === "solana");
  const primary = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  const concentration = topHolderBps(
    largest.value.map((account) => BigInt(account.amount)),
    BigInt(supply.value.amount),
  );

  const metrics: ResearchMetric[] = [
    { label: "Price", value: primary?.priceUsd ? `$${primary.priceUsd}` : "unavailable" },
    {
      label: "24h change",
      value: primary?.priceChange?.h24 === undefined ? "unavailable" : `${formatSigned(primary.priceChange.h24)}%`,
      trend: trend(primary?.priceChange?.h24),
    },
    {
      label: "24h volume",
      value: primary?.volume?.h24 === undefined ? "unavailable" : formatUsd(primary.volume.h24),
      trend: primary?.volume?.h24 ? "up" : "flat",
    },
    {
      label: "Top 10 concentration",
      value: concentration === undefined ? "unavailable" : formatBps(concentration),
      trend: "flat",
    },
    {
      label: "Supply",
      value: supply.value.uiAmountString ?? supply.value.amount,
      trend: "flat",
    },
  ];

  if (primary?.marketCap || primary?.fdv) {
    metrics.push({
      label: primary.marketCap ? "Market cap" : "FDV",
      value: formatUsd(primary.marketCap ?? primary.fdv ?? 0),
      trend: "flat",
    });
  }

  return {
    token: token.symbol,
    mint: token.mint,
    metrics,
    summary:
      `Read-only ${token.symbol} data from Solana RPC and the configured indexer. ` +
      "No buy, sell, or hold recommendation is being made.",
  };
}

function resolveToken(input: string, tokens: TokenInfo[]): TokenInfo {
  const normalized = input.trim().replace(/^\$/, "").toUpperCase();
  const bySymbol = tokens.find((token) => token.symbol.toUpperCase() === normalized);
  if (bySymbol) return bySymbol;

  try {
    const mint = new PublicKey(input.trim()).toBase58();
    return {
      symbol: input.trim().slice(0, 6).toUpperCase(),
      mint,
      decimals: 0,
      verified: false,
    };
  } catch {
    throw new Error(`Unknown token "${input}". Add it to PRAXIS_TOKENS or use a mint address.`);
  }
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

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: value > 0 && value < 1 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
  })}`;
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
