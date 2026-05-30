use anchor_lang::prelude::*;

/// One typed error per distinct failure reason (spec §5: "return a typed error,
/// distinct error per failure reason"). Anchor assigns codes from 6000 in
/// declaration order — the first seven mirror the `agent_transfer` enforcement
/// order so the wire codes are stable and self-documenting.
#[error_code]
pub enum AegisError {
    // --- agent_transfer enforcement (in order) ---
    #[msg("Signer is not the registered agent authority")]
    UnauthorizedAgent, // 6000
    #[msg("Policy is paused (or the agent has been revoked)")]
    PolicyPaused, // 6001
    #[msg("Agent session key has expired")]
    SessionExpired, // 6002
    #[msg("Amount exceeds the per-transaction limit")]
    ExceedsPerTxLimit, // 6003
    #[msg("Amount exceeds the remaining daily limit")]
    ExceedsDailyLimit, // 6004
    #[msg("Recipient is not in the allow-list")]
    RecipientNotAllowed, // 6005
    #[msg("Arithmetic overflow")]
    MathOverflow, // 6006

    // --- configuration / vault ---
    #[msg("Too many allowed programs (exceeds MAX_ALLOWED_PROGRAMS)")]
    TooManyPrograms, // 6007
    #[msg("Too many allowed recipients (exceeds MAX_ALLOWED_RECIPIENTS)")]
    TooManyRecipients, // 6008
    #[msg("Too many allowed mints (exceeds MAX_ALLOWED_MINTS)")]
    TooManyMints, // 6009
    #[msg("Invalid policy limits (expiry must be in the future)")]
    InvalidLimits, // 6010
    #[msg("Vault has insufficient balance for this transfer")]
    InsufficientVaultBalance, // 6011
    #[msg("Agent authority cannot be the default public key")]
    InvalidAgentAuthority, // 6012

    // --- agent_transfer_spl (token envelope) ---
    #[msg("Transfer mint is not the policy's configured token mint")]
    MintNotAllowed, // 6013
    #[msg("SPL token transfers are not configured for this policy")]
    SplNotConfigured, // 6014
    #[msg("Account is not a valid SPL token account for the configured mint")]
    InvalidTokenAccount, // 6015
}
