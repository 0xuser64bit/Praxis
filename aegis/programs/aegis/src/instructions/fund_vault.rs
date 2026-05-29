use crate::{constants::*, error::*, events::*, state::*};
use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

/// Owner-only. Moves SOL from the owner into the program-owned vault PDA. The
/// vault is a system-owned PDA (no data); the first fund creates it.
#[derive(Accounts)]
pub struct FundVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [SEED_POLICY, owner.key().as_ref()],
        bump = policy.bump,
        has_one = owner @ AegisError::UnauthorizedAgent,
    )]
    pub policy: Box<Account<'info, PolicyAccount>>,

    /// The program-governed SOL vault, seeded by the policy.
    #[account(
        mut,
        seeds = [SEED_VAULT, policy.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<FundVault>, amount: u64) -> Result<()> {
    let cpi = CpiContext::new(
        ctx.accounts.system_program.key(),
        Transfer {
            from: ctx.accounts.owner.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        },
    );
    system_program::transfer(cpi, amount)?;

    let new_balance = ctx.accounts.vault.lamports();
    emit!(VaultFunded {
        policy: ctx.accounts.policy.key(),
        amount,
        new_balance,
    });
    Ok(())
}
