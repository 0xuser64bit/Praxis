use crate::{constants::*, error::*, events::*, state::*};
use anchor_lang::prelude::*;

/// Owner creates the policy PDA and the audit-log PDA, and registers the agent
/// session key. The vault is created lazily on the first `fund_vault`.
#[derive(Accounts)]
pub struct InitializePolicy<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + PolicyAccount::INIT_SPACE,
        seeds = [SEED_POLICY, owner.key().as_ref()],
        bump,
    )]
    pub policy: Box<Account<'info, PolicyAccount>>,

    #[account(
        init,
        payer = owner,
        space = 8 + ActionLog::INIT_SPACE,
        seeds = [SEED_ACTION_LOG, policy.key().as_ref()],
        bump,
    )]
    pub action_log: Box<Account<'info, ActionLog>>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<InitializePolicy>,
    agent_authority: Pubkey,
    max_per_tx: u64,
    daily_limit: u64,
    allowed_programs: Vec<Pubkey>,
    allowed_recipients: Vec<Pubkey>,
    allowed_mints: Vec<Pubkey>,
    expiry_ts: i64,
) -> Result<()> {
    // Bound every Vec at its MAX before storing (account space is sized for it).
    require!(allowed_programs.len() <= MAX_ALLOWED_PROGRAMS, AegisError::TooManyPrograms);
    require!(allowed_recipients.len() <= MAX_ALLOWED_RECIPIENTS, AegisError::TooManyRecipients);
    require!(allowed_mints.len() <= MAX_ALLOWED_MINTS, AegisError::TooManyMints);

    let now = Clock::get()?.unix_timestamp;
    require!(expiry_ts > now, AegisError::InvalidLimits);
    require!(max_per_tx > 0 && daily_limit > 0, AegisError::InvalidLimits);
    require!(
        agent_authority != Pubkey::default(),
        AegisError::InvalidAgentAuthority
    );

    let policy = &mut ctx.accounts.policy;
    policy.owner = ctx.accounts.owner.key();
    policy.agent_authority = agent_authority;
    policy.max_per_tx = max_per_tx;
    policy.daily_limit = daily_limit;
    policy.spent_today = 0;
    policy.day_start_ts = now;
    policy.allowed_programs = allowed_programs;
    policy.allowed_recipients = allowed_recipients;
    policy.allowed_mints = allowed_mints;
    policy.expiry_ts = expiry_ts;
    policy.paused = false;
    policy.bump = ctx.bumps.policy;

    let log = &mut ctx.accounts.action_log;
    log.policy = policy.key();
    log.head = 0;
    log.count = 0;
    log.total = 0;
    log.entries = [ActionRecord::default(); ACTION_LOG_CAP];
    log.bump = ctx.bumps.action_log;

    emit!(PolicyInitialized {
        policy: policy.key(),
        owner: policy.owner,
        agent_authority: policy.agent_authority,
        max_per_tx,
        daily_limit,
        expiry_ts,
    });
    Ok(())
}
