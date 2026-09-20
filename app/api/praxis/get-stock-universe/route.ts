import { withReadProvider } from "@/server/api/json";
import { getServerConfig } from "@/server/env";
import { DEFAULT_STOCK_DECIMALS, STOCK_LIST, STOCK_TOKEN_PROGRAM_ID } from "@/server/stocks/universe";
import { TOKEN_PROGRAM_ID } from "@/server/aegis/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The PreStocks universe for the active-stock switcher. Read-only and
 * flag-gated — `[]` unless `PRAXIS_STOCKS_ENABLED=1`, so default behavior is
 * unchanged. No chain access; decimals come from the merged server token list.
 *
 * `transferable` tells the UI these mints cannot back a working envelope:
 * they are Token-2022 and `agent_transfer_spl` is classic-SPL only, so the
 * switcher can present them as research-only rather than offering a control
 * whose every use fails.
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
      transferable: STOCK_TOKEN_PROGRAM_ID === TOKEN_PROGRAM_ID.toBase58(),
    }));
  });
}
