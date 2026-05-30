import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  INSTRUCTION_DISCRIMINATOR,
  TOKEN_PROGRAM_ID,
} from "./constants";
import { writeI64, writePubkeyVec, writeU64 } from "./codec";

export interface AegisAddresses {
  programId: PublicKey;
  owner?: PublicKey;
  agentAuthority?: PublicKey;
  policy: PublicKey;
  vault: PublicKey;
  actionLog: PublicKey;
}

function pkList(values: string[]): PublicKey[] {
  return values.map((v) => new PublicKey(v));
}

export function buildAgentTransferIx(
  addresses: AegisAddresses & { agentAuthority: PublicKey },
  recipient: PublicKey,
  amount: bigint,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: addresses.programId,
    keys: [
      { pubkey: addresses.agentAuthority, isSigner: true, isWritable: false },
      { pubkey: addresses.policy, isSigner: false, isWritable: true },
      { pubkey: addresses.vault, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: addresses.actionLog, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([INSTRUCTION_DISCRIMINATOR.agentTransfer, writeU64(amount)]),
  });
}

export function buildConfigureTokenIx(
  addresses: AegisAddresses & { owner: PublicKey },
  args: { tokenMint: PublicKey; tokenMaxPerTx: bigint; tokenDailyLimit: bigint },
): TransactionInstruction {
  return new TransactionInstruction({
    programId: addresses.programId,
    keys: [
      { pubkey: addresses.owner, isSigner: true, isWritable: false },
      { pubkey: addresses.policy, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([
      INSTRUCTION_DISCRIMINATOR.configureToken,
      args.tokenMint.toBuffer(),
      writeU64(args.tokenMaxPerTx),
      writeU64(args.tokenDailyLimit),
    ]),
  });
}

export function buildAgentTransferSplIx(
  addresses: AegisAddresses & { agentAuthority: PublicKey },
  tokenAccounts: { vaultTokenAccount: PublicKey; recipientTokenAccount: PublicKey },
  amount: bigint,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: addresses.programId,
    keys: [
      { pubkey: addresses.agentAuthority, isSigner: true, isWritable: false },
      { pubkey: addresses.policy, isSigner: false, isWritable: true },
      { pubkey: addresses.vault, isSigner: false, isWritable: false },
      { pubkey: tokenAccounts.vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: tokenAccounts.recipientTokenAccount, isSigner: false, isWritable: true },
      { pubkey: addresses.actionLog, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([INSTRUCTION_DISCRIMINATOR.agentTransferSpl, writeU64(amount)]),
  });
}

export function buildCreateAssociatedTokenAccountIdempotentIx(args: {
  payer: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  ata: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.ata, isSigner: false, isWritable: true },
      { pubkey: args.owner, isSigner: false, isWritable: false },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    // Associated Token Account program: CreateIdempotent.
    data: Buffer.from([1]),
  });
}

export function buildTokenTransferIx(args: {
  source: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: args.source, isSigner: false, isWritable: true },
      { pubkey: args.destination, isSigner: false, isWritable: true },
      { pubkey: args.authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([3]), writeU64(args.amount)]),
  });
}

export function buildInitializePolicyIx(
  addresses: AegisAddresses & { owner: PublicKey; agentAuthority: PublicKey },
  args: {
    maxPerTx: bigint;
    dailyLimit: bigint;
    allowedPrograms: string[];
    allowedRecipients: string[];
    allowedMints: string[];
    expiryTs: number;
  },
): TransactionInstruction {
  return new TransactionInstruction({
    programId: addresses.programId,
    keys: [
      { pubkey: addresses.owner, isSigner: true, isWritable: true },
      { pubkey: addresses.policy, isSigner: false, isWritable: true },
      { pubkey: addresses.actionLog, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      INSTRUCTION_DISCRIMINATOR.initializePolicy,
      addresses.agentAuthority.toBuffer(),
      writeU64(args.maxPerTx),
      writeU64(args.dailyLimit),
      writePubkeyVec(pkList(args.allowedPrograms)),
      writePubkeyVec(pkList(args.allowedRecipients)),
      writePubkeyVec(pkList(args.allowedMints)),
      writeI64(args.expiryTs),
    ]),
  });
}

export function buildFundVaultIx(
  addresses: AegisAddresses & { owner: PublicKey },
  amount: bigint,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: addresses.programId,
    keys: [
      { pubkey: addresses.owner, isSigner: true, isWritable: true },
      { pubkey: addresses.policy, isSigner: false, isWritable: false },
      { pubkey: addresses.vault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([INSTRUCTION_DISCRIMINATOR.fundVault, writeU64(amount)]),
  });
}

/**
 * Owner-only vault withdrawal back to the owner wallet. Same account layout as
 * `fund_vault`; unconstrained by policy caps (it's the owner's money — spec §5).
 */
export function buildWithdrawVaultIx(
  addresses: AegisAddresses & { owner: PublicKey },
  amount: bigint,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: addresses.programId,
    keys: [
      { pubkey: addresses.owner, isSigner: true, isWritable: true },
      { pubkey: addresses.policy, isSigner: false, isWritable: false },
      { pubkey: addresses.vault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([INSTRUCTION_DISCRIMINATOR.withdrawVault, writeU64(amount)]),
  });
}

export function buildUpdatePolicyIx(
  addresses: AegisAddresses & { owner: PublicKey },
  args: {
    maxPerTx: bigint;
    dailyLimit: bigint;
    allowedPrograms: string[];
    allowedRecipients: string[];
    allowedMints: string[];
    expiryTs: number;
    paused: boolean;
  },
): TransactionInstruction {
  return new TransactionInstruction({
    programId: addresses.programId,
    keys: [
      { pubkey: addresses.owner, isSigner: true, isWritable: false },
      { pubkey: addresses.policy, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([
      INSTRUCTION_DISCRIMINATOR.updatePolicy,
      writeU64(args.maxPerTx),
      writeU64(args.dailyLimit),
      writePubkeyVec(pkList(args.allowedPrograms)),
      writePubkeyVec(pkList(args.allowedRecipients)),
      writePubkeyVec(pkList(args.allowedMints)),
      writeI64(args.expiryTs),
      Buffer.from([args.paused ? 1 : 0]),
    ]),
  });
}

export function buildRevokeAgentIx(
  addresses: AegisAddresses & { owner: PublicKey },
): TransactionInstruction {
  return new TransactionInstruction({
    programId: addresses.programId,
    keys: [
      { pubkey: addresses.owner, isSigner: true, isWritable: false },
      { pubkey: addresses.policy, isSigner: false, isWritable: true },
    ],
    data: INSTRUCTION_DISCRIMINATOR.revokeAgent,
  });
}

export function buildRotateAgentIx(
  addresses: AegisAddresses & { owner: PublicKey },
  newAgentAuthority: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: addresses.programId,
    keys: [
      { pubkey: addresses.owner, isSigner: true, isWritable: false },
      { pubkey: addresses.policy, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([INSTRUCTION_DISCRIMINATOR.rotateAgent, newAgentAuthority.toBuffer()]),
  });
}
