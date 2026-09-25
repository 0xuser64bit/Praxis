"use client";

import type { PolicyView } from "@praxis/shared";

import { useActiveStock } from "./ActiveStock";
import { useTokenCatalog } from "./TokenCatalog";
import { KNOWN_PROGRAMS, mintDecimals, mintLabel } from "./lib/tokenCatalog";
import { formatUnits, formatUsd, formatUsdAmount } from "./lib/units";

/**
 * How the UI names, scales and prices a mint. The label prefers the stock
 * universe (OPENAI over a bare mint), then the static catalog. Decimals come
 * only from sources that actually know: the server-supplied universe entry,
 * then the chain-confirmed token catalog, then the static catalog. The old
 * fallback of 6 silently mis-scaled the PreStocks mints (9dp) by 1000x, so an
 * unknown scale stays `undefined`.
 */
export function useTokenMeta() {
  const { stocks, symbolFor, decimalsFor } = useActiveStock();
  const { decimalsFor: catalogDecimalsFor } = useTokenCatalog();
  return {
    labelFor: (mint: string): string => symbolFor(mint) ?? mintLabel(mint) ?? "TOKEN",
    scaleFor: (mint: string): number | undefined =>
      decimalsFor(mint) ?? catalogDecimalsFor(mint) ?? mintDecimals(mint),
    usdPriceFor: (mint: string): number | undefined => {
      const price = stocks.find((s) => s.mint === mint)?.usdPrice;
      return price !== undefined && Number.isFinite(price) && price > 0 ? price : undefined;
    },
  };
}

/**
 * The vault's balance of its envelope token: "25.3163 OPENAI ≈ $1,000.00".
 * Renders nothing when no envelope is configured, and "—" while the balance
 * or the mint's scale is unknown, never a guessed zero.
 */
export function VaultTokenBalance({
  policy,
  withUsd = false,
  className,
}: {
  policy: PolicyView;
  withUsd?: boolean;
  className?: string;
}) {
  const { labelFor, scaleFor, usdPriceFor } = useTokenMeta();
  if (policy.tokenMint === KNOWN_PROGRAMS.system) return null;

  const symbol = labelFor(policy.tokenMint);
  const decimals = scaleFor(policy.tokenMint);
  const balance = policy.vaultTokenBalance;
  if (balance === undefined || decimals === undefined) {
    return (
      <span className={className} title={`The vault's ${symbol} balance can't be read right now.`}>
        — {symbol}
      </span>
    );
  }

  const price = usdPriceFor(policy.tokenMint);
  const usd = withUsd
    ? price !== undefined
      ? formatUsdAmount((Number(balance) / 10 ** decimals) * price)
      : formatUsd(balance, decimals, symbol)
    : undefined;
  return (
    <span className={className}>
      {formatUnits(balance, decimals, { maxFrac: 4 })} {symbol}
      {usd && <span className="text-[var(--text-tertiary)]"> {usd}</span>}
    </span>
  );
}
