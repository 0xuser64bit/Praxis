/**
 * Aegis contract constants — MUST stay in lockstep with the on-chain program
 * (programs/aegis/src/constants.rs). These are the bounds and seeds both the
 * agent layer and the dashboard rely on.
 */

/** PDA seeds (ASCII byte strings on-chain). */
export const SEED_POLICY = "policy";
export const SEED_VAULT = "vault";
export const SEED_ACTION_LOG = "action_log";

/**
 * Bounded-collection maximums. The on-chain account is sized for exactly these,
 * and inserts beyond them are rejected by the program — never raise these in TS
 * without re-sizing the account on-chain first.
 */
export const MAX_ALLOWED_PROGRAMS = 8;
export const MAX_ALLOWED_RECIPIENTS = 16;
export const MAX_ALLOWED_MINTS = 16;

/** Ring-buffer capacity of the on-chain ActionLog (allowed actions only). */
export const ACTION_LOG_CAP = 16;

/** Rolling daily-limit window, in seconds (24h). Matches the on-chain constant. */
export const DAY_WINDOW_SECONDS = 86_400;

/**
 * The Aegis program the demo deployment runs (devnet). A base58 string, not a
 * `PublicKey`, so surfaces with no business importing `@solana/web3.js` — the
 * marketing page, for one — can still name and link the program that does the
 * enforcing. `server/aegis/constants.ts` builds the `PublicKey` from this, and
 * `AEGIS_PROGRAM_ID` overrides it per deployment.
 */
export const DEFAULT_AEGIS_PROGRAM_ID_BASE58 =
  "3z9GuipayYpAcPnjiwFkfe6gZvfSfuPZgX8djYu67Yhd";
