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
export function findAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}
