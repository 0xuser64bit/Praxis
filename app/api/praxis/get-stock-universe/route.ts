import { withReadProvider } from "@/server/api/json";
import { getServerConfig } from "@/server/env";
import {
  DEFAULT_STOCK_DECIMALS,
  STOCK_LIST,
  isMirroredMint,
} from "@/server/stocks/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The PreStocks universe for the active-stock switcher. Read-only and
 * flag-gated — `[]` unless `PRAXIS_STOCKS_ENABLED=1`, so default behavior is
 * unchanged. No chain access; decimals come from the merged server token list.
 *
 * `mirrored` tells the UI this symbol points at a stand-in mint on the demo
 * cluster rather than the real PreStocks mint (the real ones are mainnet-only,
 * see `PRAXIS_STOCK_MINTS`). The product labels that rather than implying a
 * devnet demo is moving real pre-IPO tokens.
 */
export async function GET(request: Request) {
  return withReadProvider(request, () => {
    const config = getServerConfig();
    if (!config.stocksEnabled) return [];
    const universe = config.stockUniverse;
    return STOCK_LIST.filter((s) => !universe || universe.includes(s.symbol)).map((s) => ({
      symbol: s.symbol,
      name: s.name,
      // The configured mint, which on a demo cluster is the mirror.
      mint: config.tokens.find((t) => t.symbol === s.symbol)?.mint ?? s.mint,
      decimals: config.tokens.find((t) => t.symbol === s.symbol)?.decimals ?? DEFAULT_STOCK_DECIMALS,
      transferable: true,
      mirrored: isMirroredMint(
        s.symbol,
        config.tokens.find((t) => t.symbol === s.symbol)?.mint ?? s.mint,
      ),
    }));
  });
}
