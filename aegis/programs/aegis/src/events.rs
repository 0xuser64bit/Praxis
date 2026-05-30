use anchor_lang::prelude::*;

/// Emitted by `initialize_policy`.
#[event]
pub struct PolicyInitialized {
    pub policy: Pubkey,
    pub owner: Pubkey,
    pub agent_authority: Pubkey,
    pub max_per_tx: u64,
    pub daily_limit: u64,
    pub expiry_ts: i64,
}

/// Emitted by `update_policy`.
#[event]
pub struct PolicyUpdated {
    pub policy: Pubkey,
    pub max_per_tx: u64,
    pub daily_limit: u64,
    pub expiry_ts: i64,
    pub paused: bool,
}

#[event]
pub struct VaultFunded {
    pub policy: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
}

#[event]
pub struct VaultWithdrawn {
    pub policy: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
}

/// Emitted on a passing `agent_transfer`.
#[event]
pub struct AgentActionAllowed {
    pub policy: Pubkey,
    pub kind: u8,
    pub amount: u64,
    pub target: Pubkey,
    pub spent_today: u64,
    pub ts: i64,
}

/// Emitted just before a failing `agent_transfer` returns its typed error.
/// Lives only in the (failed) transaction's logs — state writes are reverted.
#[event]
pub struct AgentActionRejected {
    pub policy: Pubkey,
    pub kind: u8,
    /// `RejectReason` code.
    pub reason: u8,
    pub amount: u64,
    pub target: Pubkey,
    pub ts: i64,
}

/// Emitted by `configure_token` when the owner sets the SPL-token envelope.
#[event]
pub struct TokenConfigured {
    pub policy: Pubkey,
    pub token_mint: Pubkey,
    pub token_max_per_tx: u64,
    pub token_daily_limit: u64,
}

#[event]
pub struct AgentRevoked {
    pub policy: Pubkey,
    pub owner: Pubkey,
}

#[event]
pub struct AgentRotated {
    pub policy: Pubkey,
    pub new_agent_authority: Pubkey,
}

/// Emitted by `close_policy` when the owner tears down the policy.
#[event]
pub struct PolicyClosed {
    pub policy: Pubkey,
    pub owner: Pubkey,
    /// Vault SOL (lamports) returned to the owner as part of the teardown.
    pub reclaimed_vault: u64,
}
