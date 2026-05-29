use crate::{constants::*, error::*, events::*, state::*};
use anchor_lang::prelude::*;

/// Owner-only kill switch (spec §5). One on-chain tx, instant.
///
/// We do BOTH, deliberately:
///   - zero `agent_authority` -> the old key can never again equal the
///     registered key, so the very FIRST enforcement check in `agent_transfer`
///     (signer == agent_authority) fails for it; and
///   - set `paused = true` -> defense in depth and an explicit, legible intent
///     that also trips enforcement check 2.
/// Either alone would stop the agent; together the next `agent_transfer` from
/// the old key fails at check 1 with `UnauthorizedAgent`.
#[derive(Accounts)]
pub struct RevokeAgent<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_POLICY, owner.key().as_ref()],
        bump = policy.bump,
        has_one = owner @ AegisError::UnauthorizedAgent,
    )]
    pub policy: Box<Account<'info, PolicyAccount>>,
}

pub fn handler(ctx: Context<RevokeAgent>) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    policy.agent_authority = Pubkey::default();
    policy.paused = true;

    emit!(AgentRevoked {
        policy: policy.key(),
        owner: policy.owner,
    });
    Ok(())
}
