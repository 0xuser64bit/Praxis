use crate::{constants::*, error::*, events::*, state::*};
use anchor_lang::prelude::*;

/// Owner-only. Sets (or re-sets) the single SPL-token envelope: which mint the
/// agent may move via `agent_transfer_spl`, and its own per-tx / daily caps in
/// that token's base units. Resets the token rolling window to "now".
///
/// This is intentionally SEPARATE from `update_policy` (the SOL envelope): the
/// token caps live in a different unit and must not be conflated with the SOL
/// counter. Setting `token_mint` here is what makes the on-chain mint
/// allow-list enforceable in `agent_transfer_spl`.
#[derive(Accounts)]
pub struct ConfigureToken<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_POLICY, owner.key().as_ref()],
        bump = policy.bump,
        has_one = owner @ AegisError::UnauthorizedAgent,
    )]
    pub policy: Box<Account<'info, PolicyAccount>>,
}

pub fn handler(
    ctx: Context<ConfigureToken>,
    token_mint: Pubkey,
    token_max_per_tx: u64,
    token_daily_limit: u64,
) -> Result<()> {
    // A configured envelope must name a real mint and have non-zero caps.
    // (To DISABLE token transfers, this instruction is simply never called, or
    // a future explicit disable path; we do not allow configuring zeros.)
    require!(token_mint != Pubkey::default(), AegisError::MintNotAllowed);
    require!(
        token_max_per_tx > 0 && token_daily_limit > 0,
        AegisError::InvalidLimits
    );

    let now = Clock::get()?.unix_timestamp;
    let policy = &mut ctx.accounts.policy;
    policy.token_mint = token_mint;
    policy.token_max_per_tx = token_max_per_tx;
    policy.token_daily_limit = token_daily_limit;
    // Fresh window on (re)configuration so a cap change can't be back-dated.
    policy.token_spent_today = 0;
    policy.token_day_start_ts = now;

    emit!(TokenConfigured {
        policy: policy.key(),
        token_mint,
        token_max_per_tx,
        token_daily_limit,
    });
    Ok(())
}
