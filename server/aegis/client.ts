import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import type { AllowListKind, PolicyUpdate, PolicyView } from "@praxis/shared";

import {
  AEGIS_OPERATIONAL_ERROR,
  reasonFromAegisErrorCode,
} from "./constants";
import { decodeActionLog, decodePolicyAccount } from "./codec";
import {
  buildAgentTransferIx,
  buildFundVaultIx,
  buildInitializePolicyIx,
  buildRevokeAgentIx,
  buildRotateAgentIx,
  buildUpdatePolicyIx,
  type AegisAddresses,
} from "./instructions";
import { findActionLogPda, findPolicyPda, findVaultPda } from "./pdas";
import {
  getServerConfig,
  requireAgentKeypair,
  requireOwnerKeypair,
  requirePolicyAddress,
  validatePublicKey,
  type PraxisServerConfig,
} from "../env";
import { PraxisConfigError, PraxisNotFoundError } from "../errors";
import { checkFromAegisReason, checkTransferPolicy } from "../agent/policy";
import type { ActionLogEntry, PolicyCheckResult } from "@praxis/shared";

export interface TransferSimulation {
  check: PolicyCheckResult;
  simulation: string;
  networkFee: bigint;
  logs: string[];
}

export interface TransferExecution {
  sig?: string;
  check: PolicyCheckResult;
  status: "confirmed" | "rejected";
  logs: string[];
}

let connection: Connection | undefined;

export function getConnection(config = getServerConfig()): Connection {
  if (!connection) connection = new Connection(config.rpcUrl, config.commitment);
  return connection;
}

export class AegisClient {
  constructor(
    private readonly config: PraxisServerConfig = getServerConfig(),
    private readonly conn: Connection = getConnection(config),
  ) {}

  async getPolicy(): Promise<PolicyView> {
    const policyAddress = requirePolicyAddress(this.config);
    const vaultAddress = findVaultPda(policyAddress, this.config.programId);
    const [policyInfo, vaultBalance] = await Promise.all([
      this.conn.getAccountInfo(policyAddress, this.config.commitment),
      this.conn.getBalance(vaultAddress, this.config.commitment).catch(() => 0),
    ]);

    if (!policyInfo) {
      throw new PraxisNotFoundError(`Aegis policy account not found: ${policyAddress.toBase58()}`);
    }

    return decodePolicyAccount(policyAddress, policyInfo.data, BigInt(vaultBalance));
  }

  async getActionLog(): Promise<ActionLogEntry[]> {
    const policyAddress = requirePolicyAddress(this.config);
    const actionLogAddress = findActionLogPda(policyAddress, this.config.programId);
    const account = await this.conn.getAccountInfo(actionLogAddress, this.config.commitment);
    if (!account) return [];
    return decodeActionLog(account.data);
  }

  async simulateAgentTransfer(recipient: PublicKey, amount: bigint): Promise<TransferSimulation> {
    const agent = requireAgentKeypair(this.config);
    const policy = await this.getPolicy();
    const now = await this.chainTime();
    const mirrored = checkTransferPolicy(policy, amount, recipient.toBase58(), now);
    const ix = await this.agentTransferIx(agent.publicKey, recipient, amount);
    const tx = await this.buildTransaction([ix], agent.publicKey);
    tx.sign(agent);

    const sim = await this.conn.simulateTransaction(tx);

    const logs = sim.value.logs ?? [];
    const fee = await this.estimateFee(tx);
    const customCode = extractCustomErrorCode(sim.value.err, logs);
    const reasonCode = customCode === undefined ? undefined : reasonFromAegisErrorCode(customCode);

    if (reasonCode !== undefined) {
      const check = checkFromAegisReason(policy, reasonCode, amount, recipient.toBase58(), now);
      return {
        check,
        simulation: `Rejected by Aegis simulation: ${check.reason}`,
        networkFee: fee,
        logs,
      };
    }

    if (sim.value.err) {
      const reason = customCode ? AEGIS_OPERATIONAL_ERROR[customCode] : undefined;
      return {
        check: {
          allowed: false,
          reason: reason ? `Aegis rejected the operation: ${reason}.` : "Simulation failed before the transfer could be confirmed.",
          spentToday: mirrored.spentToday,
          dailyLimit: mirrored.dailyLimit,
          remaining: mirrored.remaining,
        },
        simulation: "Simulation failed",
        networkFee: fee,
        logs,
      };
    }

    const remainingAfter = mirrored.remaining > amount ? mirrored.remaining - amount : 0n;
    return {
      check: mirrored,
      simulation: mirrored.allowed
        ? `Simulation passed through Aegis; daily envelope remaining after this transfer: ${remainingAfter.toString()} lamports.`
        : `Would be rejected by Aegis: ${mirrored.reason}`,
      networkFee: fee,
      logs,
    };
  }

  async executeAgentTransfer(
    recipient: PublicKey,
    amount: bigint,
    opts: { skipPreflight?: boolean } = {},
  ): Promise<TransferExecution> {
    const agent = requireAgentKeypair(this.config);
    const policy = await this.getPolicy();
    const now = await this.chainTime();
    const ix = await this.agentTransferIx(agent.publicKey, recipient, amount);
    const tx = await this.buildTransaction([ix], agent.publicKey);
    tx.sign(agent);

    try {
      const sig = await this.conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: Boolean(opts.skipPreflight),
        preflightCommitment: this.config.commitment,
      });
      const latest = await this.conn.getLatestBlockhash(this.config.commitment);
      const confirmation = await this.conn.confirmTransaction(
        { signature: sig, ...latest },
        this.config.commitment,
      );
      const logs = await this.logsForSignature(sig);
      const customCode = extractCustomErrorCode(confirmation.value.err, logs);
      const reasonCode = customCode === undefined ? undefined : reasonFromAegisErrorCode(customCode);

      if (reasonCode !== undefined || confirmation.value.err) {
        const check = reasonCode !== undefined
          ? checkFromAegisReason(policy, reasonCode, amount, recipient.toBase58(), now)
          : {
              allowed: false,
              reason: "Transaction was rejected by the cluster.",
              spentToday: policy.spentToday,
              dailyLimit: policy.dailyLimit,
              remaining: policy.dailyLimit > policy.spentToday ? policy.dailyLimit - policy.spentToday : 0n,
            };
        return { sig, check, status: "rejected", logs };
      }

      return {
        sig,
        check: checkTransferPolicy(policy, amount, recipient.toBase58(), now),
        status: "confirmed",
        logs,
      };
    } catch (error) {
      const logs = await logsFromError(error, this.conn);
      const customCode = extractCustomErrorCode(error, logs);
      const reasonCode = customCode === undefined ? undefined : reasonFromAegisErrorCode(customCode);
      const check = reasonCode !== undefined
        ? checkFromAegisReason(policy, reasonCode, amount, recipient.toBase58(), now)
        : {
            allowed: false,
            reason: error instanceof Error ? error.message : "Transaction failed",
            spentToday: policy.spentToday,
            dailyLimit: policy.dailyLimit,
            remaining: policy.dailyLimit > policy.spentToday ? policy.dailyLimit - policy.spentToday : 0n,
          };
      return { check, status: "rejected", logs };
    }
  }

  async initializePolicy(args: {
    maxPerTx: bigint;
    dailyLimit: bigint;
    allowedPrograms: string[];
    allowedRecipients: string[];
    allowedMints: string[];
    expiryTs: number;
  }): Promise<string> {
    const owner = requireOwnerKeypair(this.config);
    const agent = requireAgentKeypair(this.config);
    const policy = findPolicyPda(owner.publicKey, this.config.programId);
    const addresses = {
      ...this.addresses({ policy }),
      owner: owner.publicKey,
      agentAuthority: agent.publicKey,
    };
    const ix = buildInitializePolicyIx(addresses, args);
    return this.sendOwnerTransaction([ix], owner);
  }

  async fundVault(amount: bigint): Promise<string> {
    const owner = requireOwnerKeypair(this.config);
    const policy = this.policyForOwner(owner.publicKey);
    const ix = buildFundVaultIx({ ...this.addresses({ policy }), owner: owner.publicKey }, amount);
    return this.sendOwnerTransaction([ix], owner);
  }

  async updatePolicy(patch: PolicyUpdate): Promise<string> {
    const owner = requireOwnerKeypair(this.config);
    const current = await this.getPolicy();
    const policy = new PublicKey(current.address);
    const ix = buildUpdatePolicyIx({ ...this.addresses({ policy }), owner: owner.publicKey }, {
      maxPerTx: patch.maxPerTx ?? current.maxPerTx,
      dailyLimit: patch.dailyLimit ?? current.dailyLimit,
      allowedPrograms: current.allowedPrograms,
      allowedRecipients: current.allowedRecipients,
      allowedMints: current.allowedMints,
      expiryTs: patch.expiryTs ?? current.expiryTs,
      paused: patch.paused ?? current.paused,
    });
    return this.sendOwnerTransaction([ix], owner);
  }

  async updateAllowList(kind: AllowListKind, address: string, mode: "add" | "remove"): Promise<string> {
    const owner = requireOwnerKeypair(this.config);
    const current = await this.getPolicy();
    const normalizedAddress = validatePublicKey(address).toBase58();
    const field = kind === "programs" ? "allowedPrograms" : kind === "recipients" ? "allowedRecipients" : "allowedMints";
    const next = new Set(current[field]);
    if (mode === "add") next.add(normalizedAddress);
    else next.delete(normalizedAddress);

    const policy = new PublicKey(current.address);
    const ix = buildUpdatePolicyIx({ ...this.addresses({ policy }), owner: owner.publicKey }, {
      maxPerTx: current.maxPerTx,
      dailyLimit: current.dailyLimit,
      allowedPrograms: field === "allowedPrograms" ? [...next] : current.allowedPrograms,
      allowedRecipients: field === "allowedRecipients" ? [...next] : current.allowedRecipients,
      allowedMints: field === "allowedMints" ? [...next] : current.allowedMints,
      expiryTs: current.expiryTs,
      paused: current.paused,
    });
    return this.sendOwnerTransaction([ix], owner);
  }

  async revokeAgent(): Promise<string> {
    const owner = requireOwnerKeypair(this.config);
    const policy = this.policyForOwner(owner.publicKey);
    const ix = buildRevokeAgentIx({ ...this.addresses({ policy }), owner: owner.publicKey });
    return this.sendOwnerTransaction([ix], owner);
  }

  async rotateAgent(): Promise<string> {
    const owner = requireOwnerKeypair(this.config);
    const nextAgent = this.config.nextAgentKeypair?.publicKey ?? requireAgentKeypair(this.config).publicKey;
    const policy = this.policyForOwner(owner.publicKey);
    const ix = buildRotateAgentIx({ ...this.addresses({ policy }), owner: owner.publicKey }, nextAgent);
    return this.sendOwnerTransaction([ix], owner);
  }

  private async agentTransferIx(
    agentAuthority: PublicKey,
    recipient: PublicKey,
    amount: bigint,
  ): Promise<TransactionInstruction> {
    const policy = requirePolicyAddress(this.config);
    return buildAgentTransferIx(
      { ...this.addresses({ policy }), agentAuthority },
      recipient,
      amount,
    );
  }

  private policyForOwner(owner: PublicKey): PublicKey {
    if (this.config.policyAddress) return this.config.policyAddress;
    return findPolicyPda(owner, this.config.programId);
  }

  private addresses(overrides: Partial<AegisAddresses> = {}): AegisAddresses {
    const policy = overrides.policy ?? requirePolicyAddress(this.config);
    return {
      programId: this.config.programId,
      owner: overrides.owner ?? this.config.ownerAddress,
      agentAuthority: overrides.agentAuthority ?? this.config.agentKeypair?.publicKey,
      policy,
      vault: findVaultPda(policy, this.config.programId),
      actionLog: findActionLogPda(policy, this.config.programId),
    };
  }

  private async buildTransaction(
    instructions: TransactionInstruction[],
    feePayer: PublicKey,
  ): Promise<Transaction> {
    const latest = await this.conn.getLatestBlockhash(this.config.commitment);
    return new Transaction({
      feePayer,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }).add(...instructions);
  }

  private async sendOwnerTransaction(instructions: TransactionInstruction[], owner: Keypair): Promise<string> {
    const tx = await this.buildTransaction(instructions, owner.publicKey);
    tx.sign(owner);
    const sig = await this.conn.sendRawTransaction(tx.serialize(), {
      preflightCommitment: this.config.commitment,
    });
    const latest = await this.conn.getLatestBlockhash(this.config.commitment);
    const confirmation = await this.conn.confirmTransaction({ signature: sig, ...latest }, this.config.commitment);
    if (confirmation.value.err) {
      throw new Error(`owner transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    return sig;
  }

  private async estimateFee(tx: Transaction): Promise<bigint> {
    const message = tx.compileMessage();
    const fee = await this.conn.getFeeForMessage(message, this.config.commitment);
    return BigInt(fee.value ?? 0);
  }

  private async chainTime(): Promise<number> {
    const slot = await this.conn.getSlot(this.config.commitment);
    return (await this.conn.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
  }

  private async logsForSignature(sig: string): Promise<string[]> {
    const tx = await this.conn.getTransaction(sig, {
      commitment: this.finality(),
      maxSupportedTransactionVersion: 0,
    });
    return tx?.meta?.logMessages ?? [];
  }

  private finality(): "confirmed" | "finalized" {
    return this.config.commitment === "finalized" ? "finalized" : "confirmed";
  }
}

function extractCustomErrorCode(errorLike: unknown, logs: string[] = []): number | undefined {
  const fromObject = findCustomCode(errorLike);
  if (fromObject !== undefined) return fromObject;

  const joined = logs.join("\n");
  const numberMatch = joined.match(/Error Number:\s*(\d+)/i);
  if (numberMatch) return Number(numberMatch[1]);
  const hexMatch = joined.match(/custom program error:\s*0x([0-9a-f]+)/i);
  if (hexMatch) return Number.parseInt(hexMatch[1], 16);
  return undefined;
}

function findCustomCode(value: unknown): number | undefined {
  if (typeof value === "number") return undefined;
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  if (typeof record.Custom === "number") return record.Custom;
  if (typeof record.custom === "number") return record.custom;
  if (Array.isArray(record.InstructionError)) {
    return findCustomCode(record.InstructionError[1]);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCustomCode(item);
      if (found !== undefined) return found;
    }
  }

  for (const item of Object.values(record)) {
    const found = findCustomCode(item);
    if (found !== undefined) return found;
  }
  return undefined;
}

async function logsFromError(error: unknown, connection: Connection): Promise<string[]> {
  if (error instanceof SendTransactionError) {
    try {
      return await error.getLogs(connection);
    } catch {
      return error.logs ?? [];
    }
  }
  if (error && typeof error === "object" && Array.isArray((error as { logs?: unknown }).logs)) {
    return (error as { logs: string[] }).logs;
  }
  return [];
}

export function assertPolicyConfigured(config = getServerConfig()) {
  if (!config.policyAddress && !config.ownerAddress) {
    throw new PraxisConfigError("Aegis policy is not configured.");
  }
}
