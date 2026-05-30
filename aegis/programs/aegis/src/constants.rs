use anchor_lang::prelude::*;

/// PDA seeds. Kept in lockstep with `@praxis/shared` (shared/src/constants.ts).
#[constant]
pub const SEED_POLICY: &[u8] = b"policy";
#[constant]
pub const SEED_VAULT: &[u8] = b"vault";
#[constant]
pub const SEED_ACTION_LOG: &[u8] = b"action_log";

/// Bounded-collection maximums. Every `Vec<Pubkey>` on `PolicyAccount` is
/// `#[max_len]`-sized to exactly these, the account space is reserved for the
/// maximum, and `initialize_policy` / `update_policy` reject any input longer
/// than the bound. NEVER raise one of these without re-sizing the account.
pub const MAX_ALLOWED_PROGRAMS: usize = 8;
pub const MAX_ALLOWED_RECIPIENTS: usize = 16;
pub const MAX_ALLOWED_MINTS: usize = 16;

/// Capacity of the on-chain `ActionLog` ring buffer (allowed actions only).
pub const ACTION_LOG_CAP: usize = 16;

/// Rolling daily-limit window, in seconds (24h). The reset comparison is
/// `now >= day_start_ts + DAY_WINDOW_SECONDS` (spec §5).
pub const DAY_WINDOW_SECONDS: i64 = 86_400;
