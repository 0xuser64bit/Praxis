import { PublicKey } from "@solana/web3.js";

import { ASSOCIATED_TOKEN_PROGRAM_ID, SEEDS, TOKEN_PROGRAM_ID } from "./constants";

export function findPolicyPda(owner: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEEDS.policy, owner.toBuffer()], programId)[0];
}

export function findVaultPda(policy: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEEDS.vault, policy.toBuffer()], programId)[0];
}

export function findActionLogPda(policy: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEEDS.actionLog, policy.toBuffer()], programId)[0];
}

/**
 * Canonical associated token account for `owner` + `mint` (classic SPL Token
 * program). Derived locally — no @solana/spl-token dependency.
 */
/**
 * The associated-token address for `owner`/`mint`.
 *
 * The token program id is part of the seeds, so a Token-2022 mint's ATA lives
 * at a DIFFERENT address than the classic derivation would give. Passing the
 * wrong program here doesn't fail loudly — it silently computes an address
 * that will never hold the tokens.
 */
export function findAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey = TOKEN_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}
