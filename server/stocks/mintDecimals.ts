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
  const lookup = await lookupMint(connection, mint);
  return lookup.status === "ok" ? lookup.info.decimals : undefined;
}

/** Convenience wrapper: the mint's facts, or undefined if we can't read them. */
export async function resolveMintInfo(
  connection: Connection,
  mint: string,
): Promise<MintInfo | undefined> {
  const lookup = await lookupMint(connection, mint);
  return lookup.status === "ok" ? lookup.info : undefined;
}

/**
 * The outcome of reading a mint account. `unsupported-program` is kept
 * distinct from `unavailable` so callers can tell "this token is issued by
 * something we can't drive" from "we couldn't reach the chain" — very
 * different things to tell a user.
 */
export type MintLookup =
  | { status: "ok"; info: MintInfo }
  | { status: "unsupported-program"; programId: string }
  | { status: "unavailable" };

async function lookupMint(connection: Connection, mint: string): Promise<MintLookup> {
  const cached = cache.get(mint);
  if (cached !== undefined) return { status: "ok", info: cached };

  let address: PublicKey;
  try {
    address = new PublicKey(mint);
  } catch {
    return { status: "unavailable" };
  }

  try {
    const info = await withTimeout(
      connection.getAccountInfo(address, "confirmed"),
      envTimeout("PRAXIS_RPC_READ_TIMEOUT_MS", 8_000),
      `mint decimals ${mint}`,
    );
    if (!info) {
      logger.warn("mint.decimals_missing_account", { mint });
      return { status: "unavailable" };
    }

    const owner = info.owner.toBase58();
    const knownTokenProgram =
      info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID);
    if (!knownTokenProgram) {
      // Never read byte 44 of an arbitrary account and call it a scale.
      logger.warn("mint.unsupported_owner", { mint, owner });
      return { status: "unsupported-program", programId: owner };
    }
    if (info.data.length < MINT_BASE_SIZE) {
      logger.warn("mint.decimals_unexpected_account", { mint, owner, size: info.data.length });
      return { status: "unavailable" };
    }

    const decimals = info.data[DECIMALS_OFFSET];
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
      logger.warn("mint.decimals_out_of_range", { mint, decimals });
      return { status: "unavailable" };
    }

    const resolved: MintInfo = { decimals, programId: owner };
    cache.set(mint, resolved);
    return { status: "ok", info: resolved };
  } catch (error) {
    logger.warn("mint.decimals_lookup_failed", { mint, ...errorFields(error) });
    return { status: "unavailable" };
  }
}

/**
 * Whether Aegis can actually move this mint, and why not when it cannot.
 *
 * `agent_transfer_spl` drives the token program by CPI, so the mint must be
 * owned by one Aegis knows how to invoke: classic SPL Token or Token-2022.
 * Anything else (or a mint absent from the transfer cluster) is refused up
 * front, because the alternative is an opaque "the vault or recipient token
 * account may not exist yet" after a full simulation round-trip — a
 * setup-sounding error for a structural fact.
 *
 * Token-2022 matters specifically because the PreStocks pre-IPO mints are
 * issued under it (verified on mainnet 2026-09-20).
 */
export type MintMovability =
  | { movable: true; info: MintInfo }
  | { movable: false; reason: "unresolved" }
  | { movable: false; reason: "wrong-token-program"; programId: string };

export async function checkMintMovable(
  connection: Connection,
  mint: string,
  supportedTokenProgramIds: string[],
): Promise<MintMovability> {
  const lookup = await lookupMint(connection, mint);
  if (lookup.status === "unavailable") return { movable: false, reason: "unresolved" };
  if (lookup.status === "unsupported-program") {
    return { movable: false, reason: "wrong-token-program", programId: lookup.programId };
  }
  if (!supportedTokenProgramIds.includes(lookup.info.programId)) {
    return { movable: false, reason: "wrong-token-program", programId: lookup.info.programId };
  }
  return { movable: true, info: lookup.info };
}

/** The token programs `agent_transfer_spl` can drive. */
export function supportedTokenPrograms(classic: string, token2022: string): string[] {
  return [classic, token2022];
}
