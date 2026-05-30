use crate::{constants::*, error::*, events::*, state::*};
use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

/// Owner-only teardown (spec §5: the owner key is unconstrained). Drains any
/// remaining SOL from the vault back to the owner, then closes the policy and
/// audit-log accounts — returning their rent to the owner. Irreversible; the
/// owner can re-create a fresh policy afterward (same deterministic PDA).
///
/// Phase 1 is SOL-only. A configured token envelope's vault token account is a
/// separate account this instruction does not touch; the client refuses to
/// close while a token balance remains so funds are never silently stranded.
#[derive(Accounts)]
pub struct ClosePolicy<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        close = owner,
        seeds = [SEED_POLICY, owner.key().as_ref()],
        bump = policy.bump,
        has_one = owner @ AegisError::UnauthorizedAgent,
    )]
    pub policy: Box<Account<'info, PolicyAccount>>,

    #[account(
        mut,
        close = owner,
        seeds = [SEED_ACTION_LOG, policy.key().as_ref()],
        bump = action_log.bump,
    )]
    pub action_log: Box<Account<'info, ActionLog>>,

    #[account(
        mut,
        seeds = [SEED_VAULT, policy.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClosePolicy>) -> Result<()> {
    let reclaimed_vault = ctx.accounts.vault.lamports();

    // Drain the vault back to the owner before the accounts are closed. The
    // policy + action_log rent is returned separately by Anchor's `close`.
    if reclaimed_vault > 0 {
        let policy_key = ctx.accounts.policy.key();
        let vault_bump = ctx.bumps.vault;
        let signer_seeds: &[&[&[u8]]] = &[&[SEED_VAULT, policy_key.as_ref(), &[vault_bump]]];

        let cpi = CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.owner.to_account_info(),
            },
            signer_seeds,
        );
        system_program::transfer(cpi, reclaimed_vault)?;
    }

    emit!(PolicyClosed {
        policy: ctx.accounts.policy.key(),
        owner: ctx.accounts.owner.key(),
        reclaimed_vault,
    });
    Ok(())
}
