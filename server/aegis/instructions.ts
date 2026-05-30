import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import { INSTRUCTION_DISCRIMINATOR, TOKEN_PROGRAM_ID } from "./constants";
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
