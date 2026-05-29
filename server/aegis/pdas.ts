import { PublicKey } from "@solana/web3.js";

import { SEEDS } from "./constants";

export function findPolicyPda(owner: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEEDS.policy, owner.toBuffer()], programId)[0];
}

export function findVaultPda(policy: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEEDS.vault, policy.toBuffer()], programId)[0];
}

export function findActionLogPda(policy: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEEDS.actionLog, policy.toBuffer()], programId)[0];
}
