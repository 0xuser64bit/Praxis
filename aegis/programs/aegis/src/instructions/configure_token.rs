use crate::{constants::*, error::*, events::*, state::*};
use anchor_lang::prelude::*;

/// Owner-only. Sets (or re-sets) the single SPL-token envelope: which mint the
/// agent may move via `agent_transfer_spl`, and its own per-tx / daily caps in
/// that token's base units. Starts a fresh token rolling window only when the
/// mint changes; re-setting the same mint's caps keeps the live window.
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

    let policy = &mut ctx.accounts.policy;
    // A new mint is a new asset in new units, so its window starts fresh. The
    // same mint keeps today's spend, as `update_policy` does for SOL: a new cap
    // applies to the live window. Resetting it let "raise my daily limit"
    // grant a second full day's allowance today, and let a signature that
    // LOWERED the limit hand the agent headroom it was meant to remove.
    if policy.token_mint != token_mint {
        policy.token_spent_today = 0;
        policy.token_day_start_ts = Clock::get()?.unix_timestamp;
    }
    policy.token_mint = token_mint;
    policy.token_max_per_tx = token_max_per_tx;
    policy.token_daily_limit = token_daily_limit;

    emit!(TokenConfigured {
        policy: policy.key(),
        token_mint,
        token_max_per_tx,
        token_daily_limit,
    });
    Ok(())
}
