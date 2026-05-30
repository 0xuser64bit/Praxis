use crate::{constants::*, error::*, events::*, state::*};
use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
    },
};

/// The SPL Token program (classic). The token CPI is built and invoked RAW
/// (no `anchor-spl` dependency) so the program has zero extra deps; the handler
/// hand-parses the token accounts and constructs the `Transfer` instruction.
const SPL_TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/// Classic SPL token account byte layout offsets (165-byte `Account`).
const TOKEN_ACCOUNT_LEN: usize = 165;
const STATE_INITIALIZED: u8 = 1;

/// Agent-initiated SPL-token transfer from the vault's token account, gated by
/// the policy's DEDICATED token envelope (separate from the SOL envelope).
///
/// Enforces, in order: signer == agent → !paused → !expired → token configured
/// → mint == `policy.token_mint` (the on-chain mint allow-list) → per-tx cap →
/// token day-rollover → token daily cap → vault token balance. On pass it CPIs
/// an `spl_token::transfer` from the vault token account to the recipient's.
#[derive(Accounts)]
pub struct AgentTransferSpl<'info> {
    pub agent_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_POLICY, policy.owner.as_ref()],
        bump = policy.bump,
    )]
    pub policy: Box<Account<'info, PolicyAccount>>,

    /// The vault PDA — the AUTHORITY over the vault's token account. Signs the
    /// token CPI via seeds; never read as data.
    #[account(
        seeds = [SEED_VAULT, policy.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    /// CHECK: hand-validated in the handler — must be a 165-byte SPL token
    /// account owned by the SPL Token program, with `mint == policy.token_mint`
    /// and `authority == vault`.
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,

    /// CHECK: hand-validated in the handler — must be a 165-byte SPL token
    /// account owned by the SPL Token program with `mint == policy.token_mint`.
    #[account(mut)]
    pub recipient_token_account: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_ACTION_LOG, policy.key().as_ref()],
        bump = action_log.bump,
    )]
    pub action_log: Box<Account<'info, ActionLog>>,

    /// CHECK: must be the SPL Token program; verified in the handler.
    pub token_program: UncheckedAccount<'info>,
}

fn emit_rejected(policy: Pubkey, reason: RejectReason, amount: u64, target: Pubkey, ts: i64) {
    emit!(AgentActionRejected {
        policy,
        kind: KIND_TRANSFER_SPL,
        reason: reason.code(),
        amount,
        target,
        ts,
    });
}

/// Parsed view of the fixed fields we need from a classic SPL token account.
struct TokenAccountView {
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
}

/// Hand-parse + validate a classic 165-byte SPL token account. Returns its
/// mint/owner/amount. Errors (InvalidTokenAccount) if it isn't an initialized
/// token account owned by the SPL Token program.
fn read_token_account(acct: &AccountInfo) -> Result<TokenAccountView> {
    require_keys_eq!(
        *acct.owner,
        SPL_TOKEN_PROGRAM_ID,
        AegisError::InvalidTokenAccount
    );
    let data = acct.try_borrow_data()?;
    require!(
        data.len() == TOKEN_ACCOUNT_LEN,
        AegisError::InvalidTokenAccount
    );
    // state byte at offset 108 (mint 32 + owner 32 + amount 8 + delegate 36).
    require!(
        data[108] == STATE_INITIALIZED,
        AegisError::InvalidTokenAccount
    );

    let mint =
        Pubkey::try_from(&data[0..32]).map_err(|_| error!(AegisError::InvalidTokenAccount))?;
    let owner =
        Pubkey::try_from(&data[32..64]).map_err(|_| error!(AegisError::InvalidTokenAccount))?;
    let amount = u64::from_le_bytes(
        data[64..72]
            .try_into()
            .map_err(|_| error!(AegisError::InvalidTokenAccount))?,
    );
    Ok(TokenAccountView {
        mint,
        owner,
        amount,
    })
}

pub fn handler(ctx: Context<AgentTransferSpl>, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let policy_key = ctx.accounts.policy.key();

    // 1. signer == agent_authority (the single most important line).
    if ctx.accounts.agent_authority.key() != ctx.accounts.policy.agent_authority {
        emit_rejected(
            policy_key,
            RejectReason::Unauthorized,
            amount,
            Pubkey::default(),
            now,
        );
        return err!(AegisError::UnauthorizedAgent);
    }

    // 2. !paused && now < expiry_ts.
    if ctx.accounts.policy.paused {
        emit_rejected(
            policy_key,
            RejectReason::Paused,
            amount,
            Pubkey::default(),
            now,
        );
        return err!(AegisError::PolicyPaused);
    }
    if now >= ctx.accounts.policy.expiry_ts {
        emit_rejected(
            policy_key,
            RejectReason::Expired,
            amount,
            Pubkey::default(),
            now,
        );
        return err!(AegisError::SessionExpired);
    }

    // 3. token envelope must be configured (mint set).
    let token_mint = ctx.accounts.policy.token_mint;
    require_keys_neq!(token_mint, Pubkey::default(), AegisError::SplNotConfigured);

    // 4. token program sanity + parse/validate both token accounts.
    require_keys_eq!(
        ctx.accounts.token_program.key(),
        SPL_TOKEN_PROGRAM_ID,
        AegisError::InvalidTokenAccount
    );
    let source = read_token_account(&ctx.accounts.vault_token_account.to_account_info())?;
    let dest = read_token_account(&ctx.accounts.recipient_token_account.to_account_info())?;
    let target = dest.owner;

    // 5. ON-CHAIN MINT ALLOW-LIST: both accounts must be the configured mint.
    if source.mint != token_mint || dest.mint != token_mint {
        emit_rejected(
            policy_key,
            RejectReason::MintNotAllowed,
            amount,
            target,
            now,
        );
        return err!(AegisError::MintNotAllowed);
    }
    // Source must be the vault's own token account (vault is the authority).
    require_keys_eq!(
        source.owner,
        ctx.accounts.vault.key(),
        AegisError::InvalidTokenAccount
    );

    // 6. if allowed_recipients non-empty -> token-account owner must be in it.
    let recipients = &ctx.accounts.policy.allowed_recipients;
    if !recipients.is_empty() && !recipients.contains(&target) {
        emit_rejected(
            policy_key,
            RejectReason::RecipientNotAllowed,
            amount,
            target,
            now,
        );
        return err!(AegisError::RecipientNotAllowed);
    }

    // 7. amount <= token_max_per_tx (boundary == is allowed).
    if amount > ctx.accounts.policy.token_max_per_tx {
        emit_rejected(policy_key, RejectReason::OverPerTx, amount, target, now);
        return err!(AegisError::ExceedsPerTxLimit);
    }

    // 8. token day rollover (independent of the SOL window).
    let window_end = ctx
        .accounts
        .policy
        .token_day_start_ts
        .checked_add(DAY_WINDOW_SECONDS)
        .ok_or(error!(AegisError::MathOverflow))?;
    if now >= window_end {
        ctx.accounts.policy.token_spent_today = 0;
        ctx.accounts.policy.token_day_start_ts = now;
    }

    // 9. token_spent_today + amount <= token_daily_limit.
    let new_spent = match ctx.accounts.policy.token_spent_today.checked_add(amount) {
        Some(v) => v,
        None => {
            emit_rejected(policy_key, RejectReason::Overflow, amount, target, now);
            return err!(AegisError::MathOverflow);
        }
    };
    if new_spent > ctx.accounts.policy.token_daily_limit {
        emit_rejected(policy_key, RejectReason::OverDaily, amount, target, now);
        return err!(AegisError::ExceedsDailyLimit);
    }

    // Operational: the vault token account must hold the funds.
    require!(
        source.amount >= amount,
        AegisError::InsufficientVaultBalance
    );

    // ---- Passed: commit spend, CPI the token transfer, audit ----
    ctx.accounts.policy.token_spent_today = new_spent;

    // spl_token `Transfer`: instruction tag 3, then amount (u64 LE).
    // Accounts: [source (w), destination (w), authority (signer)].
    let mut data = Vec::with_capacity(9);
    data.push(3u8);
    data.extend_from_slice(&amount.to_le_bytes());
    let ix = Instruction {
        program_id: SPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(ctx.accounts.vault_token_account.key(), false),
            AccountMeta::new(ctx.accounts.recipient_token_account.key(), false),
            AccountMeta::new_readonly(ctx.accounts.vault.key(), true),
        ],
        data,
    };
    let vault_bump = ctx.bumps.vault;
    let signer_seeds: &[&[&[u8]]] = &[&[SEED_VAULT, policy_key.as_ref(), &[vault_bump]]];
    invoke_signed(
        &ix,
        &[
            ctx.accounts.vault_token_account.to_account_info(),
            ctx.accounts.recipient_token_account.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
        signer_seeds,
    )?;

    ctx.accounts.action_log.push(ActionRecord {
        kind: KIND_TRANSFER_SPL,
        amount,
        target,
        mint: token_mint,
        result: RESULT_ALLOWED,
        reason: 0,
        ts: now,
    });

    emit!(AgentActionAllowed {
        policy: policy_key,
        kind: KIND_TRANSFER_SPL,
        amount,
        target,
        spent_today: new_spent,
        ts: now,
    });
    Ok(())
}
