use crate::{constants::*, error::*, events::*, state::*};
use anchor_lang::prelude::*;

/// Owner-only. Swaps in a fresh agent session key (spec §5).
///
/// Rotating also clears `paused` so the new key is immediately usable — the
/// intent of "rotate" is to install a working key. To rotate WITHOUT enabling,
/// call `rotate_agent` then `update_policy{ paused: true }`.
#[derive(Accounts)]
pub struct RotateAgent<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_POLICY, owner.key().as_ref()],
        bump = policy.bump,
        has_one = owner @ AegisError::UnauthorizedAgent,
    )]
    pub policy: Box<Account<'info, PolicyAccount>>,
}

pub fn handler(ctx: Context<RotateAgent>, new_agent_authority: Pubkey) -> Result<()> {
    require!(
        new_agent_authority != Pubkey::default(),
        AegisError::InvalidAgentAuthority
    );

    let policy = &mut ctx.accounts.policy;
    policy.agent_authority = new_agent_authority;
    policy.paused = false;

    emit!(AgentRotated {
        policy: policy.key(),
        new_agent_authority,
    });
    Ok(())
}
