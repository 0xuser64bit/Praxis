use crate::{constants::*, error::*, events::*, state::*};
use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

/// Agent-initiated SOL transfer from the vault, gated by the on-chain policy.
///
/// `agent_authority` is a `Signer`, but that only proves *someone* signed — the
/// handler still explicitly checks the signer IS the registered agent key
/// (check 1). This is the single most important line in the program (spec §5).
#[derive(Accounts)]
pub struct AgentTransfer<'info> {
    /// The agent's scoped session key. Must equal `policy.agent_authority`.
    pub agent_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_POLICY, policy.owner.as_ref()],
        bump = policy.bump,
    )]
    pub policy: Box<Account<'info, PolicyAccount>>,

    #[account(
        mut,
        seeds = [SEED_VAULT, policy.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    /// CHECK: arbitrary transfer destination; gated by the allow-list in the
    /// handler (check 6) and only ever credited lamports, never read.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_ACTION_LOG, policy.key().as_ref()],
        bump = action_log.bump,
    )]
    pub action_log: Box<Account<'info, ActionLog>>,

    pub system_program: Program<'info, System>,
}

/// Emit the rejection event (survives in the failed tx's logs, since the
/// returned `Err` reverts all account state). Centralized so every reject path
/// is consistent.
fn emit_rejected(policy: Pubkey, reason: RejectReason, amount: u64, target: Pubkey, ts: i64) {
    emit!(AgentActionRejected {
        policy,
        kind: KIND_TRANSFER,
        reason: reason.code(),
        amount,
        target,
        ts,
    });
}

pub fn handler(ctx: Context<AgentTransfer>, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let policy_key = ctx.accounts.policy.key();
    let target = ctx.accounts.recipient.key();

    // ---- Enforcement, in the EXACT spec §5 order ----

    // 1. signer == agent_authority (explicit, beyond the Signer constraint).
    if ctx.accounts.agent_authority.key() != ctx.accounts.policy.agent_authority {
        emit_rejected(policy_key, RejectReason::Unauthorized, amount, target, now);
        return err!(AegisError::UnauthorizedAgent);
    }

    // 2. !paused && now < expiry_ts.
    if ctx.accounts.policy.paused {
        emit_rejected(policy_key, RejectReason::Paused, amount, target, now);
        return err!(AegisError::PolicyPaused);
    }
    if now >= ctx.accounts.policy.expiry_ts {
        emit_rejected(policy_key, RejectReason::Expired, amount, target, now);
        return err!(AegisError::SessionExpired);
    }

    // 3. amount <= max_per_tx  (boundary: exactly == max_per_tx is ALLOWED).
    if amount > ctx.accounts.policy.max_per_tx {
        emit_rejected(policy_key, RejectReason::OverPerTx, amount, target, now);
        return err!(AegisError::ExceedsPerTxLimit);
    }

    // 4. day rollover: if now >= day_start_ts + 86400 -> reset window.
    let window_end = ctx
        .accounts
        .policy
        .day_start_ts
        .checked_add(DAY_WINDOW_SECONDS)
        .ok_or(error!(AegisError::MathOverflow))?;
    if now >= window_end {
        ctx.accounts.policy.spent_today = 0;
        ctx.accounts.policy.day_start_ts = now;
    }

    // 5. spent_today + amount <= daily_limit (checked_add; reject on overflow).
    //    (boundary: spent_today + amount exactly == daily_limit is ALLOWED.)
    let new_spent = match ctx.accounts.policy.spent_today.checked_add(amount) {
        Some(v) => v,
        None => {
            emit_rejected(policy_key, RejectReason::Overflow, amount, target, now);
            return err!(AegisError::MathOverflow);
        }
    };
    if new_spent > ctx.accounts.policy.daily_limit {
        emit_rejected(policy_key, RejectReason::OverDaily, amount, target, now);
        return err!(AegisError::ExceedsDailyLimit);
    }

    // 6. if allowed_recipients non-empty -> recipient must be in it.
    let recipients = &ctx.accounts.policy.allowed_recipients;
    if !recipients.is_empty() && !recipients.contains(&target) {
        emit_rejected(policy_key, RejectReason::RecipientNotAllowed, amount, target, now);
        return err!(AegisError::RecipientNotAllowed);
    }

    // Operational (not a policy rejection): the vault must hold the funds.
    require!(
        ctx.accounts.vault.lamports() >= amount,
        AegisError::InsufficientVaultBalance
    );

    // ---- Passed: commit spend, CPI the transfer (vault -> recipient), audit ----
    ctx.accounts.policy.spent_today = new_spent;

    let vault_bump = ctx.bumps.vault;
    let signer_seeds: &[&[&[u8]]] = &[&[SEED_VAULT, policy_key.as_ref(), &[vault_bump]]];
    let cpi = CpiContext::new_with_signer(
        ctx.accounts.system_program.key(),
        Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.recipient.to_account_info(),
        },
        signer_seeds,
    );
    system_program::transfer(cpi, amount)?;

    ctx.accounts.action_log.push(ActionRecord {
        kind: KIND_TRANSFER,
        amount,
        target,
        result: RESULT_ALLOWED,
        reason: 0,
        ts: now,
    });

    emit!(AgentActionAllowed {
        policy: policy_key,
        kind: KIND_TRANSFER,
        amount,
        target,
        spent_today: new_spent,
        ts: now,
    });
    Ok(())
}
