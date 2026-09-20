import { Connection, PublicKey } from "@solana/web3.js";

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../aegis/constants";
import { envTimeout, withTimeout } from "../api/timeout";
import { errorFields, logger } from "../observability/logger";

/**
 * On-chain facts about an SPL mint: its scale, and which token program owns it.
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

/** What the chain says about a mint. */
export interface MintInfo {
  decimals: number;
  /** Owning token program — classic SPL Token, Token-2022, … */
  programId: string;
}

const cache = new Map<string, MintInfo>();
/** Operator-supplied decimals, authoritative over the chain's (never over the program). */
const decimalsOverrides = new Map<string, number>();

export function __resetMintDecimalsCacheForTests() {
  cache.clear();
  decimalsOverrides.clear();
}

/**
 * Pin a mint's decimals from a trusted source (an operator override).
 *
 * Deliberately does NOT imply the mint is movable: an override says "I know
 * this scale", not "I have checked which token program owns this". The
 * movability check always consults the chain.
 */
export function primeMintDecimals(mint: string, decimals: number): void {
  if (Number.isInteger(decimals) && decimals >= 0 && decimals <= MAX_DECIMALS) {
    decimalsOverrides.set(mint, decimals);
  }
}

/**
 * Read a mint's decimals, or `undefined` when neither an override nor the
 * chain can confirm them.
 *
 * `undefined` means "unknown", never a default: callers must refuse to do
 * amount math rather than fall back to a guess.
 */
export async function resolveMintDecimals(
  connection: Connection,
  mint: string,
): Promise<number | undefined> {
  const override = decimalsOverrides.get(mint);
  if (override !== undefined) return override;
  return (await resolveMintInfo(connection, mint))?.decimals;
}

/**
 * Read a mint account, or `undefined` when the chain cannot answer — because
 * it is unreachable, or because the mint does not exist on *this* cluster.
 * Both are reasons to refuse, never to assume.
 */
export async function resolveMintInfo(
  connection: Connection,
  mint: string,
): Promise<MintInfo | undefined> {
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

    const resolved: MintInfo = { decimals, programId: info.owner.toBase58() };
    cache.set(mint, resolved);
    return resolved;
  } catch (error) {
    logger.warn("mint.decimals_lookup_failed", { mint, ...errorFields(error) });
    return undefined;
  }
}

/**
 * Whether Aegis can actually move this mint, and why not when it cannot.
 *
 * The deployed `agent_transfer_spl` hard-requires the classic SPL Token
 * program and 165-byte token accounts (it hand-parses them and builds the
 * CPI raw, with no anchor-spl dependency). A Token-2022 mint therefore cannot
 * be moved by it at all — not with different caps, not with a prepared ATA:
 * the associated-token address itself is derived from the token program id,
 * so even the vault's account would be at the wrong address.
 *
 * The PreStocks pre-IPO mints are Token-2022 (verified on mainnet
 * 2026-09-20), which is why stock buys are preview-only today. Surfacing that
 * here turns an opaque "the vault or recipient token account may not exist
 * yet" deep in simulation into an accurate answer before anything is built.
 */
export type MintMovability =
  | { movable: true; info: MintInfo }
  | { movable: false; reason: "unresolved" }
  | { movable: false; reason: "wrong-token-program"; programId: string };

export async function checkMintMovable(
  connection: Connection,
  mint: string,
  classicTokenProgramId: string,
): Promise<MintMovability> {
  const info = await resolveMintInfo(connection, mint);
  if (!info) return { movable: false, reason: "unresolved" };
  if (info.programId !== classicTokenProgramId) {
    return { movable: false, reason: "wrong-token-program", programId: info.programId };
  }
  return { movable: true, info };
}
