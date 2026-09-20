import { Connection, PublicKey } from "@solana/web3.js";

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../aegis/constants";
import { envTimeout, withTimeout } from "../api/timeout";
import { errorFields, logger } from "../observability/logger";

/**
 * On-chain decimals for an SPL mint.
 *
 * The PreStocks API does not report decimals, and the universe shipped a
 * hard-coded `6` for all eight pre-IPO mints — a value the spike report itself
 * lists as an open question. Decimals are the exponent on every amount the
 * agent moves: if a mint is 9-dp, "buy 40 OPENAI" parsed at 6-dp asks the
 * program to move a thousand times the intended quantity. That is not a value
 * to guess, so it is read from the chain and cached.
 *
 * Mint decimals are immutable, so a process-lifetime cache is exact, never
 * stale.
 */

/** SPL Mint layout: `decimals` is a u8 at byte 44 of the 82-byte base account. */
const DECIMALS_OFFSET = 44;
const MINT_BASE_SIZE = 82;
const MAX_DECIMALS = 18;

const cache = new Map<string, number>();

export function __resetMintDecimalsCacheForTests() {
  cache.clear();
}

/** Seed the cache from a trusted source (an operator override, or a test). */
export function primeMintDecimals(mint: string, decimals: number): void {
  if (Number.isInteger(decimals) && decimals >= 0 && decimals <= MAX_DECIMALS) {
    cache.set(mint, decimals);
  }
}

/**
 * Read a mint's decimals, or `undefined` when the chain cannot confirm them.
 *
 * `undefined` means "unknown", never a default: callers must refuse to do
 * amount math rather than fall back to a guess.
 */
export async function resolveMintDecimals(
  connection: Connection,
  mint: string,
): Promise<number | undefined> {
  const cached = cache.get(mint);
  if (cached !== undefined) return cached;

  let address: PublicKey;
  try {
    address = new PublicKey(mint);
  } catch {
    return undefined;
  }

  try {
    const info = await withTimeout(
      connection.getAccountInfo(address, "confirmed"),
      envTimeout("PRAXIS_RPC_READ_TIMEOUT_MS", 8_000),
      `mint decimals ${mint}`,
    );
    if (!info) {
      logger.warn("mint.decimals_missing_account", { mint });
      return undefined;
    }
    const ownedByTokenProgram =
      info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID);
    if (!ownedByTokenProgram || info.data.length < MINT_BASE_SIZE) {
      // Not a mint (or a layout we do not understand) — refuse rather than
      // read a byte out of an arbitrary account and call it a scale.
      logger.warn("mint.decimals_unexpected_account", {
        mint,
        owner: info.owner.toBase58(),
        size: info.data.length,
      });
      return undefined;
    }

    const decimals = info.data[DECIMALS_OFFSET];
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
      logger.warn("mint.decimals_out_of_range", { mint, decimals });
      return undefined;
    }

    cache.set(mint, decimals);
    return decimals;
  } catch (error) {
    logger.warn("mint.decimals_lookup_failed", { mint, ...errorFields(error) });
    return undefined;
  }
}
