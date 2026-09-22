use crate::error::*;
use anchor_lang::prelude::*;

/// The vault is a system-owned PDA with no data. The Solana runtime refuses any
/// transaction that leaves a funded account below the rent-exempt minimum, so
/// "the vault holds N lamports" is not the same as "N lamports are spendable":
/// the reserve has to stay behind or the whole transaction fails with an opaque
/// `InsufficientFundsForRent` instead of a typed Aegis error.
///
/// Every lamport-moving path therefore measures against this, not `lamports()`.
pub fn rent_reserve() -> Result<u64> {
    Ok(Rent::get()?.minimum_balance(0))
}

/// What the agent may move out of the vault: the balance above the reserve.
/// Saturating, so an under-funded vault reads as zero spendable rather than
/// wrapping.
pub fn spendable_lamports(vault_lamports: u64) -> Result<u64> {
    Ok(vault_lamports.saturating_sub(rent_reserve()?))
}

/// An owner-initiated debit may either leave the vault rent-exempt or empty it
/// completely (the PDA is then deallocated and recreated by the next fund).
/// Anything in between is the rent-paying state the runtime rejects.
pub fn assert_owner_debit_allowed(vault_lamports: u64, amount: u64) -> Result<()> {
    require!(amount <= vault_lamports, AegisError::InsufficientVaultBalance);
    let left = vault_lamports - amount;
    require!(
        left == 0 || left >= rent_reserve()?,
        AegisError::VaultRentExemption
    );
    Ok(())
}
