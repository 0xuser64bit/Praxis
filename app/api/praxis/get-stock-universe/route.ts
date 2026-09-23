import { withReadProvider } from "@/server/api/json";
import { getConnection } from "@/server/aegis/client";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/server/aegis/constants";
import { getServerConfig } from "@/server/env";
import { checkMintsMovable, supportedTokenPrograms } from "@/server/stocks/mintDecimals";
import { fetchPrestocksEntries, findPrestocksEntry } from "@/server/stocks/prestocks";
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
 * unchanged.
 *
 * `transferable` used to be hard-coded `true`, which made it a claim rather
 * than a check: a deployment whose `PRAXIS_STOCK_MINTS` were not created on
 * its own cluster still advertised every symbol as a pickable envelope, and
 * the owner found out only after signing. It is now the cluster's verdict —
 * one batched account read for the whole universe.
 *
 * `mirrored` tells the UI this symbol points at a stand-in mint on the demo
 * cluster rather than the real PreStocks mint (the real ones are mainnet-only,
 * see `PRAXIS_STOCK_MINTS`). The product labels that rather than implying a
 * devnet demo is moving real pre-IPO tokens.
 *
 * `usdPrice` (PreStocks tokenPrice, absent when the feed is down) lets the
 * policy screen default a stock's caps in dollars.
 */
export async function GET(request: Request) {
  return withReadProvider(request, async () => {
    const config = getServerConfig();
    if (!config.stocksEnabled) return [];
    const universe = config.stockUniverse;
    // Never throws: a failed feed is [] (or a recent good answer).
    const quotes = await fetchPrestocksEntries(config.prestocksApiUrl, config.prestocksTimeoutMs);

    const entries = STOCK_LIST.filter((s) => !universe || universe.includes(s.symbol)).map((s) => {
      const configured = config.tokens.find((t) => t.symbol === s.symbol);
      // The configured mint, which on a demo cluster is the mirror.
      const mint = configured?.mint ?? s.mint;
      return {
        symbol: s.symbol,
        name: s.name,
        mint,
        decimals: configured?.decimals ?? DEFAULT_STOCK_DECIMALS,
        mirrored: isMirroredMint(s.symbol, mint),
        usdPrice: findPrestocksEntry(quotes, s.symbol)?.tokenPrice,
      };
    });

    if (process.env.PRAXIS_ALLOW_UNVERIFIED_MINTS === "1") {
      return entries.map((entry) => ({ ...entry, transferable: true }));
    }

    const verdicts = await checkMintsMovable(
      getConnection(config),
      entries.map((entry) => entry.mint),
      supportedTokenPrograms(TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()),
    );

    return entries.map((entry) => {
      const verdict = verdicts.get(entry.mint);
      return {
        ...entry,
        // The chain's scale beats the configured one wherever it is known.
        decimals: verdict?.movable ? verdict.info.decimals : entry.decimals,
        transferable: verdict?.movable === true,
      };
    });
  });
}
