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

/** The shape of an account as both RPC read paths return it. */
type FetchedAccount = { owner: PublicKey; data: Buffer | Uint8Array } | null;

/**
 * Turn a fetched account into a verdict, caching the ones that are mints.
 *
 * Shared by the single and batched read paths so a mint cannot be judged by
 * two different rules depending on how it was fetched.
 */
function decodeMintAccount(mint: string, info: FetchedAccount): MintLookup {
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
}

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
    return decodeMintAccount(mint, info);
  } catch (error) {
    logger.warn("mint.decimals_lookup_failed", { mint, ...errorFields(error) });
    return { status: "unavailable" };
  }
}

/** `getMultipleAccountsInfo` caps out at 100 addresses per request. */
const MAX_ACCOUNTS_PER_REQUEST = 100;

/**
 * Look several mints up in as few round trips as possible.
 *
 * A catalog screen asks about every configured mint at once; doing that one
 * `getAccountInfo` at a time turns one page load into N serial RPC calls. A
 * single mint still takes the single-account path — it is one request either
 * way, and it keeps this function honest against callers that only implement
 * `getAccountInfo`.
 */
export async function lookupMints(
  connection: Connection,
  mints: string[],
): Promise<Map<string, MintLookup>> {
  const out = new Map<string, MintLookup>();
  const pending: { mint: string; address: PublicKey }[] = [];

  for (const mint of new Set(mints)) {
    const cached = cache.get(mint);
    if (cached !== undefined) {
      out.set(mint, { status: "ok", info: cached });
      continue;
    }
    try {
      pending.push({ mint, address: new PublicKey(mint) });
    } catch {
      out.set(mint, { status: "unavailable" });
    }
  }

  if (pending.length === 1) {
    out.set(pending[0].mint, await lookupMint(connection, pending[0].mint));
    return out;
  }

  for (let i = 0; i < pending.length; i += MAX_ACCOUNTS_PER_REQUEST) {
    const chunk = pending.slice(i, i + MAX_ACCOUNTS_PER_REQUEST);
    try {
      const infos = await withTimeout(
        connection.getMultipleAccountsInfo(chunk.map((entry) => entry.address), "confirmed"),
        envTimeout("PRAXIS_RPC_READ_TIMEOUT_MS", 8_000),
        `mint decimals x${chunk.length}`,
      );
      chunk.forEach((entry, index) => {
        out.set(entry.mint, decodeMintAccount(entry.mint, infos[index] ?? null));
      });
    } catch (error) {
      logger.warn("mint.decimals_batch_lookup_failed", {
        mints: chunk.length,
        ...errorFields(error),
      });
      // A failed batch is "we could not read", never "these do not exist".
      for (const entry of chunk) out.set(entry.mint, { status: "unavailable" });
    }
  }

  return out;
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
  return verdictFor(await lookupMint(connection, mint), supportedTokenProgramIds);
}

/** {@link checkMintMovable} for many mints, in as few RPC calls as possible. */
export async function checkMintsMovable(
  connection: Connection,
  mints: string[],
  supportedTokenProgramIds: string[],
): Promise<Map<string, MintMovability>> {
  const lookups = await lookupMints(connection, mints);
  const out = new Map<string, MintMovability>();
  for (const [mint, lookup] of lookups) {
    out.set(mint, verdictFor(lookup, supportedTokenProgramIds));
  }
  return out;
}

function verdictFor(lookup: MintLookup, supportedTokenProgramIds: string[]): MintMovability {
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
