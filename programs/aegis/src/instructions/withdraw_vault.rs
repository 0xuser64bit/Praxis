use crate::{constants::*, error::*, events::*, state::*};
use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

/// Owner-only and UNCONSTRAINED by policy — it's the owner's money (spec §5).
/// No caps, no allow-list, no expiry/pause checks apply here.
#[derive(Accounts)]
pub struct WithdrawVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [SEED_POLICY, owner.key().as_ref()],
        bump = policy.bump,
        has_one = owner @ AegisError::UnauthorizedAgent,
    )]
    pub policy: Box<Account<'info, PolicyAccount>>,

    #[account(
        mut,
        seeds = [SEED_VAULT, policy.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<WithdrawVault>, amount: u64) -> Result<()> {
    require!(
        ctx.accounts.vault.lamports() >= amount,
        AegisError::InsufficientVaultBalance
    );

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
    system_program::transfer(cpi, amount)?;

    emit!(VaultWithdrawn {
        policy: policy_key,
        amount,
        new_balance: ctx.accounts.vault.lamports(),
    });
    Ok(())
}
