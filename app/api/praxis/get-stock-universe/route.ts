import { withReadProvider } from "@/server/api/json";
import { getServerConfig } from "@/server/env";
import { DEFAULT_STOCK_DECIMALS, STOCK_LIST } from "@/server/stocks/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stocklana C05: the PreStocks universe for the active-stock switcher.
 * Read-only and flag-gated — `[]` unless `PRAXIS_STOCKS_ENABLED=1`, so default
 * behavior is unchanged. No chain access; decimals resolve from the merged
 * server token list (provisional 6 until the RPC spike confirms per-mint
 * values — see docs/PRESTOCKS-SPIKE.md).
 */
export async function GET(request: Request) {
  return withReadProvider(request, () => {
    const config = getServerConfig();
    if (!config.stocksEnabled) return [];
    const universe = config.stockUniverse;
    return STOCK_LIST.filter((s) => !universe || universe.includes(s.symbol)).map((s) => ({
      symbol: s.symbol,
      name: s.name,
      mint: s.mint,
      decimals: config.tokens.find((t) => t.mint === s.mint)?.decimals ?? DEFAULT_STOCK_DECIMALS,
    }));
  });
}
