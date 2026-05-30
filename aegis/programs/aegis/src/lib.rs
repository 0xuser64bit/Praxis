//! Aegis — the on-chain policy engine (spec §5). A program-owned smart wallet
//! that custodies a slice of the owner's SOL and enforces a spending envelope
//! on every agent-initiated transfer. The owner key is unconstrained; the agent
//! session key may only move funds within the policy. "The agent proposes; the
//! chain disposes."
//!
//! Scope: native-SOL `agent_transfer` + full enforcement, an SPL-token
//! `agent_transfer_spl` gated by a DEDICATED token envelope (its own caps) and
//! an on-chain single-mint allow-list (`configure_token`), vault
//! funding/withdrawal, revoke/rotate, and an on-chain audit log. `agent_swap`
//! (Jupiter CPI) and the multi-entry `allowed_programs`/`allowed_mints` Vecs
//! remain out of scope (swaps are v2); the token allow-list here is the
//! single-mint form enforced on the token transfer path.

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("7qRKV1dNPCixKWDLHsuHa5puFsNPtNCzC1sX6P1kpFgb");

#[program]
pub mod aegis {
    use super::*;

    /// Owner creates the policy + audit log and registers the agent key.
    #[allow(clippy::too_many_arguments)]
    pub fn initialize_policy(
        ctx: Context<InitializePolicy>,
        agent_authority: Pubkey,
        max_per_tx: u64,
        daily_limit: u64,
        allowed_programs: Vec<Pubkey>,
        allowed_recipients: Vec<Pubkey>,
        allowed_mints: Vec<Pubkey>,
        expiry_ts: i64,
    ) -> Result<()> {
        initialize_policy::handler(
            ctx,
            agent_authority,
            max_per_tx,
            daily_limit,
            allowed_programs,
            allowed_recipients,
            allowed_mints,
            expiry_ts,
        )
    }

    /// Owner-only. Adjust caps, allow-lists, expiry, paused.
    #[allow(clippy::too_many_arguments)]
    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        max_per_tx: u64,
        daily_limit: u64,
        allowed_programs: Vec<Pubkey>,
        allowed_recipients: Vec<Pubkey>,
        allowed_mints: Vec<Pubkey>,
        expiry_ts: i64,
        paused: bool,
    ) -> Result<()> {
        update_policy::handler(
            ctx,
            max_per_tx,
            daily_limit,
            allowed_programs,
            allowed_recipients,
            allowed_mints,
            expiry_ts,
            paused,
        )
    }

    /// Owner-only. Fund the program-owned SOL vault.
    pub fn fund_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
        fund_vault::handler(ctx, amount)
    }

    /// Owner-only and UNCONSTRAINED by policy — it's the owner's money.
    pub fn withdraw_vault(ctx: Context<WithdrawVault>, amount: u64) -> Result<()> {
        withdraw_vault::handler(ctx, amount)
    }

    /// Agent-initiated. Enforces the full policy (see `agent_transfer`).
    pub fn agent_transfer(ctx: Context<AgentTransfer>, amount: u64) -> Result<()> {
        agent_transfer::handler(ctx, amount)
    }

    /// Owner-only. Configure the single SPL-token envelope (mint + token caps).
    pub fn configure_token(
        ctx: Context<ConfigureToken>,
        token_mint: Pubkey,
        token_max_per_tx: u64,
        token_daily_limit: u64,
    ) -> Result<()> {
        configure_token::handler(ctx, token_mint, token_max_per_tx, token_daily_limit)
    }

    /// Agent-initiated SPL-token transfer. Enforces the dedicated token envelope
    /// + the on-chain mint allow-list (see `agent_transfer_spl`).
    pub fn agent_transfer_spl(ctx: Context<AgentTransferSpl>, amount: u64) -> Result<()> {
        agent_transfer_spl::handler(ctx, amount)
    }

    /// Owner-only kill switch. Zeroes the agent key and pauses.
    pub fn revoke_agent(ctx: Context<RevokeAgent>) -> Result<()> {
        revoke_agent::handler(ctx)
    }

    /// Owner-only. Swap in a fresh agent session key (and unpause).
    pub fn rotate_agent(ctx: Context<RotateAgent>, new_agent_authority: Pubkey) -> Result<()> {
        rotate_agent::handler(ctx, new_agent_authority)
    }
}
