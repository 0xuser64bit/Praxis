use crate::{constants::*, error::*, events::*, state::*};
use anchor_lang::prelude::*;

/// Owner-only. Adjusts caps, allow-lists, expiry, and the paused flag. Does NOT
/// touch `spent_today` / `day_start_ts` (the live window) or `agent_authority`
/// (use `rotate_agent` for the key).
#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_POLICY, owner.key().as_ref()],
        bump = policy.bump,
        has_one = owner @ AegisError::UnauthorizedAgent,
    )]
    pub policy: Box<Account<'info, PolicyAccount>>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<UpdatePolicy>,
    max_per_tx: u64,
    daily_limit: u64,
    allowed_programs: Vec<Pubkey>,
    allowed_recipients: Vec<Pubkey>,
    allowed_mints: Vec<Pubkey>,
    expiry_ts: i64,
    paused: bool,
) -> Result<()> {
    require!(allowed_programs.len() <= MAX_ALLOWED_PROGRAMS, AegisError::TooManyPrograms);
    require!(allowed_recipients.len() <= MAX_ALLOWED_RECIPIENTS, AegisError::TooManyRecipients);
    require!(allowed_mints.len() <= MAX_ALLOWED_MINTS, AegisError::TooManyMints);
    require!(max_per_tx > 0 && daily_limit > 0, AegisError::InvalidLimits);
    require!(
        expiry_ts > Clock::get()?.unix_timestamp,
        AegisError::InvalidLimits
    );

    let policy = &mut ctx.accounts.policy;
    policy.max_per_tx = max_per_tx;
    policy.daily_limit = daily_limit;
    policy.allowed_programs = allowed_programs;
    policy.allowed_recipients = allowed_recipients;
    policy.allowed_mints = allowed_mints;
    policy.expiry_ts = expiry_ts;
    policy.paused = paused;

    emit!(PolicyUpdated {
        policy: policy.key(),
        max_per_tx,
        daily_limit,
        expiry_ts,
        paused,
    });
    Ok(())
}
