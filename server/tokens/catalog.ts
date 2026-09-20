/**
 * Which SPL mints this deployment can actually offer, checked against the
 * cluster it transfers on.
 *
 * The web client used to carry its own hard-coded list (USDC / JUP / BONK,
 * mainnet addresses) and offer it everywhere regardless of where the backend
 * was pointed. On the devnet demo every one of those addresses is a plain
 * System-owned account, so picking one walked the owner through a wallet
 * signature only to be told the mint "is owned by 1111…1111, which is neither
 * SPL Token nor Token-2022". The catalog is not a client-side constant: it is
 * a fact about a cluster, so the server answers it.
 *
 * `agent_transfer_spl` drives SPL Token or Token-2022 by CPI. Anything else is
 * reported, never quietly dropped — an operator who pointed `PRAXIS_TOKENS` at
 * the wrong cluster should be able to see that from the product.
 */

import type { Connection } from "@solana/web3.js";

import { getConnection } from "../aegis/client";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../aegis/constants";
import { getServerConfig, type PraxisServerConfig } from "../env";
import { checkMintsMovable, supportedTokenPrograms } from "../stocks/mintDecimals";
import { STOCK_SYMBOLS } from "../stocks/universe";

/**
 * - `movable`  — the mint exists here and Aegis can drive its token program.
 * - `wrong-program` — it exists but under a program `agent_transfer_spl`
 *   cannot CPI into. Permanent; no amount of retrying fixes it.
 * - `missing`  — not readable on this cluster (absent, or the RPC failed).
 *   Deliberately not conflated with the above: one is "wrong token", the
 *   other is "wrong cluster, or try again".
 */
export type TokenCatalogStatus = "movable" | "wrong-program" | "missing";

export interface TokenCatalogEntry {
  symbol: string;
  mint: string;
  /** Chain-confirmed decimals; `null` when the mint could not be read. */
  decimals: number | null;
  status: TokenCatalogStatus;
  /** The owning program, when `status === "wrong-program"`. */
  programId?: string;
  /** True for wrapped SOL, which is a mint but not an envelope candidate. */
  native?: boolean;
}

/** The escape hatch the Aegis client honours; the catalog must agree with it. */
function verificationDisabled(): boolean {
  return process.env.PRAXIS_ALLOW_UNVERIFIED_MINTS === "1";
}

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

/**
 * Every configured non-stock token, with the cluster's verdict on each.
 *
 * Stock symbols are excluded: they have their own universe endpoint and their
 * own switcher, and listing them twice would give the owner two controls that
 * configure the same envelope.
 */
export async function resolveTokenCatalog(
  config: PraxisServerConfig = getServerConfig(),
  connection: Connection = getConnection(config),
): Promise<TokenCatalogEntry[]> {
  const stocks = new Set(STOCK_SYMBOLS);
  const candidates = config.tokens.filter((token) => !stocks.has(token.symbol.toUpperCase()));
  if (candidates.length === 0) return [];

  if (verificationDisabled()) {
    return candidates.map((token) => ({
      symbol: token.symbol,
      mint: token.mint,
      decimals: token.decimals,
      status: "movable" as const,
      native: token.mint === WRAPPED_SOL,
    }));
  }

  const verdicts = await checkMintsMovable(
    connection,
    candidates.map((token) => token.mint),
    supportedTokenPrograms(TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()),
  );

  return candidates.map((token) => {
    const verdict = verdicts.get(token.mint);
    const native = token.mint === WRAPPED_SOL;
    if (verdict?.movable) {
      // The chain's decimals win over the configured ones — they are the
      // exponent every amount is scaled by, and only one of the two is a fact.
      return {
        symbol: token.symbol,
        mint: token.mint,
        decimals: verdict.info.decimals,
        status: "movable" as const,
        native,
      };
    }
    if (verdict && !verdict.movable && verdict.reason === "wrong-token-program") {
      return {
        symbol: token.symbol,
        mint: token.mint,
        decimals: null,
        status: "wrong-program" as const,
        programId: verdict.programId,
        native,
      };
    }
    return {
      symbol: token.symbol,
      mint: token.mint,
      decimals: null,
      status: "missing" as const,
      native,
    };
  });
}
