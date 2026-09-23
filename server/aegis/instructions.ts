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

/**
 * `agent_transfer_spl`. The account order mirrors the Anchor struct exactly:
 * agent, policy, vault, vault ATA, recipient ATA, **mint**, action log, token
 * program. The mint is required because the on-chain CPI is `TransferChecked`
 * — the token program re-verifies mint and decimals rather than trusting a
 * caller-supplied number.
 *
 * `tokenProgramId` must be the program that actually owns the mint (classic
 * SPL or Token-2022); the on-chain handler requires both token accounts and
 * the mint to belong to it.
 */
export function buildAgentTransferSplIx(
  addresses: AegisAddresses & { agentAuthority: PublicKey },
  tokenAccounts: {
    vaultTokenAccount: PublicKey;
    recipientTokenAccount: PublicKey;
    mint: PublicKey;
    tokenProgramId?: PublicKey;
  },
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
      { pubkey: tokenAccounts.mint, isSigner: false, isWritable: false },
      { pubkey: addresses.actionLog, isSigner: false, isWritable: true },
      {
        pubkey: tokenAccounts.tokenProgramId ?? TOKEN_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
    ],
    data: Buffer.concat([INSTRUCTION_DISCRIMINATOR.agentTransferSpl, writeU64(amount)]),
  });
}

/**
 * ATA CreateIdempotent. `tokenProgramId` must own the mint — it is both an
 * account of this instruction and a seed of the derived address, so a classic
 * default against a Token-2022 mint creates nothing usable.
 */
export function buildCreateAssociatedTokenAccountIdempotentIx(args: {
  payer: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  ata: PublicKey;
  tokenProgramId?: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.ata, isSigner: false, isWritable: true },
      { pubkey: args.owner, isSigner: false, isWritable: false },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: args.tokenProgramId ?? TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    // Associated Token Account program: CreateIdempotent.
    data: Buffer.from([1]),
  });
}

/** SPL Token / Token-2022 `MintTo` (tag 7, u64 LE amount). The demo faucet only. */
export function buildMintToIx(args: {
  mint: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  amount: bigint;
  tokenProgramId: PublicKey;
}): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(7, 0);
  data.writeBigUInt64LE(args.amount, 1);
  return new TransactionInstruction({
    programId: args.tokenProgramId,
    keys: [
      { pubkey: args.mint, isSigner: false, isWritable: true },
      { pubkey: args.destination, isSigner: false, isWritable: true },
      { pubkey: args.authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

/**
 * Owner-signed token transfer (vault funding), as `TransferChecked` so the
 * token program verifies the mint and decimals. Token-2022 deprecates the
 * unchecked variant, so passing the mint is required for either program.
 */
export function buildTokenTransferIx(args: {
  source: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  mint: PublicKey;
  decimals: number;
  amount: bigint;
  tokenProgramId?: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: args.tokenProgramId ?? TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: args.source, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.destination, isSigner: false, isWritable: true },
      { pubkey: args.authority, isSigner: true, isWritable: false },
    ],
    // TransferChecked: tag 12, amount (u64 LE), decimals (u8).
    data: Buffer.concat([Buffer.from([12]), writeU64(args.amount), Buffer.from([args.decimals])]),
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
 * `fund_vault`; unconstrained by policy caps (it's the owner's money).
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

/**
 * Owner-only teardown: drains the vault to the owner and closes the policy +
 * action-log accounts (rent → owner). Account order matches the `close_policy`
 * context: owner, policy, action_log, vault, system_program.
 */
export function buildClosePolicyIx(
  addresses: AegisAddresses & { owner: PublicKey },
): TransactionInstruction {
  return new TransactionInstruction({
    programId: addresses.programId,
    keys: [
      { pubkey: addresses.owner, isSigner: true, isWritable: true },
      { pubkey: addresses.policy, isSigner: false, isWritable: true },
      { pubkey: addresses.actionLog, isSigner: false, isWritable: true },
      { pubkey: addresses.vault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: INSTRUCTION_DISCRIMINATOR.closePolicy,
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
