use crate::constants::*;
use anchor_lang::prelude::*;

/// Action kind discriminants (stored as `u8`).
/// `KIND_TRANSFER` = native SOL; `KIND_TRANSFER_SPL` = an SPL-token transfer.
pub const KIND_TRANSFER: u8 = 0;
pub const KIND_TRANSFER_SPL: u8 = 1;

/// Result discriminants for `ActionRecord.result`.
pub const RESULT_REJECTED: u8 = 0;
pub const RESULT_ALLOWED: u8 = 1;

/// Why an agent action was rejected. The `u8` codes mirror
/// `@praxis/shared` (`RejectReason`) and are emitted in `AgentActionRejected`.
/// Ordering follows the `agent_transfer` enforcement sequence.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RejectReason {
    Unauthorized = 0,
    Paused = 1,
    Expired = 2,
    OverPerTx = 3,
    OverDaily = 4,
    RecipientNotAllowed = 5,
    Overflow = 6,
    /// The token transfer's mint is not the policy's configured `token_mint`
    /// (the on-chain mint allow-list, single-mint form). SPL path only.
    MintNotAllowed = 7,
}

impl RejectReason {
    pub fn code(self) -> u8 {
        self as u8
    }
}

/// The on-chain spending envelope (spec §5). PDA seeded by `owner`.
///
/// The `owner` key is unconstrained elsewhere (deposit/withdraw/update/revoke);
/// the `agent_authority` session key may only move funds within this envelope.
/// `allowed_programs` / `allowed_mints` are stored for the swap phase and are
/// NOT enforced by `agent_transfer` (transfers are SOL, recipient-gated only).
#[account]
#[derive(InitSpace)]
pub struct PolicyAccount {
    pub owner: Pubkey,
    /// The registered scoped signer. Set to `Pubkey::default()` on revoke.
    pub agent_authority: Pubkey,
    pub max_per_tx: u64,
    pub daily_limit: u64,
    pub spent_today: u64,
    /// Unix seconds; start of the current rolling 24h window.
    pub day_start_ts: i64,
    #[max_len(MAX_ALLOWED_PROGRAMS)]
    pub allowed_programs: Vec<Pubkey>,
    /// Empty == any recipient allowed (spec §5).
    #[max_len(MAX_ALLOWED_RECIPIENTS)]
    pub allowed_recipients: Vec<Pubkey>,
    #[max_len(MAX_ALLOWED_MINTS)]
    pub allowed_mints: Vec<Pubkey>,
    /// Unix seconds; the session key auto-expires at/after this.
    pub expiry_ts: i64,
    pub paused: bool,
    pub bump: u8,

    // --- Dedicated SPL-token envelope ---
    //
    // A token transfer (`agent_transfer_spl`) is a different asset than the SOL
    // vault, with different decimals and value, so it CANNOT share the SOL
    // `spent_today`/`daily_limit` counter — mixing 6-dp USDC base units into a
    // 9-dp lamports cap is meaningless. It gets its own envelope, tracked
    // independently. Appended after `bump` so the existing serialized layout
    // (and the TS codec offsets) is unchanged.
    /// The single SPL mint the agent may move via `agent_transfer_spl`.
    /// `Pubkey::default()` == SPL transfers disabled (not configured). Enforced
    /// on-chain: a token transfer's mint MUST equal this — the on-chain mint
    /// allow-list, single-mint form. Set via `configure_token` (owner-only).
    pub token_mint: Pubkey,
    /// Per-tx cap in the token's own base units.
    pub token_max_per_tx: u64,
    /// Rolling daily cap in the token's own base units.
    pub token_daily_limit: u64,
    pub token_spent_today: u64,
    /// Unix seconds; start of the current rolling 24h window for the token.
    pub token_day_start_ts: i64,
}

/// One audited action. Fixed-size so it lives in the ring buffer below.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, Debug)]
pub struct ActionRecord {
    pub kind: u8,
    pub amount: u64,
    pub target: Pubkey,
    /// Asset mint for SPL transfers. `Pubkey::default()` means native SOL.
    pub mint: Pubkey,
    /// `RESULT_ALLOWED` / `RESULT_REJECTED`.
    pub result: u8,
    /// `RejectReason` code; meaningful only when `result == RESULT_REJECTED`.
    pub reason: u8,
    /// Unix seconds.
    pub ts: i64,
}

/// On-chain audit log: a fixed-capacity ring buffer of `ActionRecord`s, PDA
/// seeded by `policy`. Powers the "auditable without trust" activity feed.
///
/// NOTE: only ALLOWED actions are durably recorded here. A rejected
/// `agent_transfer` returns `Err`, which reverts ALL account writes — so a
/// rejected record cannot be persisted in the same failing instruction.
/// Rejections are surfaced via the typed error + the `AgentActionRejected`
/// event (visible in the failed transaction's logs). See `agent_transfer`.
#[account]
#[derive(InitSpace)]
pub struct ActionLog {
    pub policy: Pubkey,
    /// Next write index (mod `ACTION_LOG_CAP`).
    pub head: u16,
    /// Number of valid entries (saturates at `ACTION_LOG_CAP`).
    pub count: u16,
    /// Monotonic total of allowed actions ever recorded.
    pub total: u64,
    pub entries: [ActionRecord; ACTION_LOG_CAP],
    pub bump: u8,
}

impl ActionLog {
    /// Append a record, overwriting the oldest once full.
    pub fn push(&mut self, rec: ActionRecord) {
        let idx = (self.head as usize) % ACTION_LOG_CAP;
        self.entries[idx] = rec;
        self.head = self.head.wrapping_add(1);
        if (self.count as usize) < ACTION_LOG_CAP {
            self.count += 1;
        }
        self.total = self.total.saturating_add(1);
    }
}
