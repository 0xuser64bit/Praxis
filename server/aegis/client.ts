import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  MAX_ALLOWED_MINTS,
  type AllowListKind,
  type PolicyUpdate,
  type PolicyView,
} from "@praxis/shared";

import {
  AEGIS_OPERATIONAL_ERROR,
  JUPITER_PROGRAM_ID,
  reasonFromAegisErrorCode,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants";
import { decodeActionLog, decodePolicyAccount } from "./codec";
import {
  buildAgentTransferIx,
  buildAgentTransferSplIx,
  buildConfigureTokenIx,
  buildCreateAssociatedTokenAccountIdempotentIx,
  buildFundVaultIx,
  buildInitializePolicyIx,
  buildRevokeAgentIx,
  buildRotateAgentIx,
  buildTokenTransferIx,
  buildUpdatePolicyIx,
  type AegisAddresses,
} from "./instructions";
import { findActionLogPda, findAssociatedTokenAddress, findPolicyPda, findVaultPda } from "./pdas";
import {
  getServerConfig,
  requireOwnerKeypair,
  requirePolicyAddress,
  validatePublicKey,
  type PraxisServerConfig,
} from "../env";
import {
  requireAgentSigner,
  resolveNextAgentPublicKey,
  type AgentSigner,
} from "../agent/agentSigner";
import { PraxisConfigError, PraxisInputError, PraxisNotFoundError } from "../errors";
import {
  checkFromAegisReason,
  checkTokenFromAegisReason,
  checkTokenTransferPolicy,
  checkTransferPolicy,
} from "../agent/policy";
import type { ActionLogEntry, PolicyCheckResult, TokenInfo } from "@praxis/shared";
import { formatSol, formatUnits, parseHumanUnits, SOL_DECIMALS } from "../units";

/**
 * An owner/admin policy action. Built server-side as an unsigned transaction the
 * owner WALLET signs (production custody), or sent directly by the backend owner
 * keypair (local/devnet fallback). Token setup actions stay on the keypair path.
 */
export type OwnerAction =
  | { kind: "bootstrapPolicy" }
  | { kind: "updatePolicy"; patch: PolicyUpdate }
  | { kind: "allowList"; listKind: AllowListKind; address: string; mode: "add" | "remove" }
  | { kind: "revoke" }
  | { kind: "rotate" };

/** A serialized unsigned owner transaction plus the blockhash to confirm it. */
export interface UnsignedOwnerTransaction {
  /** base64-encoded, unsigned legacy transaction with feePayer = owner wallet. */
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

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

export interface TokenAccountSetupResult {
  mint: string;
  vaultTokenAccount: string;
  recipientTokenAccounts: string[];
  created: string[];
  existing: string[];
  sig?: string;
}

interface BuiltTransaction {
  tx: Transaction;
  latestBlockhash: {
    blockhash: string;
    lastValidBlockHeight: number;
  };
}

const BOOTSTRAP_POLICY_TTL_SECONDS = 7 * 86_400;
const BOOTSTRAP_MAX_PER_TX = parseHumanUnits("50", SOL_DECIMALS);
const BOOTSTRAP_DAILY_LIMIT = parseHumanUnits("5", SOL_DECIMALS);
const BOOTSTRAP_VAULT_FUNDING = parseHumanUnits("1", SOL_DECIMALS);

let connection: Connection | undefined;

export function getConnection(config = getServerConfig()): Connection {
  if (!connection) connection = new Connection(config.rpcUrl, config.commitment);
  return connection;
}

export class AegisClient {
  private cachedAgentSigner?: AgentSigner;

  constructor(
    private readonly config: PraxisServerConfig = getServerConfig(),
    private readonly conn: Connection = getConnection(config),
    agentSigner?: AgentSigner,
  ) {
    this.cachedAgentSigner = agentSigner;
  }

  /** The configured agent signer (local keypair or remote custody), resolved once. */
  private agentSigner(): AgentSigner {
    if (!this.cachedAgentSigner) {
      this.cachedAgentSigner = requireAgentSigner(this.config.agentKeypair);
    }
    return this.cachedAgentSigner;
  }

  /**
   * Simulate without a real agent signature (execute-only signing). The on-chain
   * policy checks read the agent account, not its signature, so the verdict is
   * faithful — and remote custody avoids a signer round-trip per preview.
   */
  private async simulateUnsigned(tx: Transaction) {
    const versioned = new VersionedTransaction(tx.compileMessage());
    return this.conn.simulateTransaction(versioned, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });
  }

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
    const signer = this.agentSigner();
    const policy = await this.getPolicy();
    const now = await this.chainTime();
    const mirrored = checkTransferPolicy(policy, amount, recipient.toBase58(), now);
    const ix = await this.agentTransferIx(signer.publicKey, recipient, amount);
    const { tx } = await this.buildTransaction([ix], signer.publicKey);

    const sim = await this.simulateUnsigned(tx);

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
        ? `Simulation passed through Aegis; within your ${formatSol(mirrored.dailyLimit)} SOL daily limit; ${formatSol(remainingAfter)} SOL remaining after this transfer.`
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
    const signer = this.agentSigner();
    const policy = await this.getPolicy();
    const now = await this.chainTime();
    const ix = await this.agentTransferIx(signer.publicKey, recipient, amount);
    const { tx, latestBlockhash } = await this.buildTransaction([ix], signer.publicKey);
    await signer.signTransaction(tx);

    try {
      const sig = await this.conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: Boolean(opts.skipPreflight),
        preflightCommitment: this.config.commitment,
      });
      const confirmation = await this.conn.confirmTransaction(
        { signature: sig, ...latestBlockhash },
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

  async simulateAgentTransferSpl(
    recipient: PublicKey,
    token: TokenInfo,
    amount: bigint,
  ): Promise<TransferSimulation> {
    const signer = this.agentSigner();
    const policy = await this.getPolicy();
    const now = await this.chainTime();
    const recipientAddress = recipient.toBase58();
    const mirrored = checkTokenTransferPolicy(policy, token, amount, recipientAddress, now);
    const ix = await this.agentTransferSplIx(signer.publicKey, recipient, token, amount);
    const { tx } = await this.buildTransaction([ix], signer.publicKey);

    const sim = await this.simulateUnsigned(tx);
    const logs = sim.value.logs ?? [];
    const fee = await this.estimateFee(tx);
    const customCode = extractCustomErrorCode(sim.value.err, logs);
    const reasonCode = customCode === undefined ? undefined : reasonFromAegisErrorCode(customCode);

    if (reasonCode !== undefined) {
      const check = checkTokenFromAegisReason(policy, token, reasonCode, amount, recipientAddress, now);
      return { check, simulation: `Rejected by Aegis simulation: ${check.reason}`, networkFee: fee, logs };
    }
    if (sim.value.err) {
      const reason = customCode ? AEGIS_OPERATIONAL_ERROR[customCode] : undefined;
      return {
        check: {
          allowed: false,
          reason: reason
            ? `Aegis rejected the operation: ${reason}.`
            : "Token-transfer simulation failed (the vault or recipient token account may not exist yet).",
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
        ? `Simulation passed through Aegis; within your ${formatUnits(mirrored.dailyLimit, token.decimals)} ${token.symbol} daily limit; ${formatUnits(remainingAfter, token.decimals)} ${token.symbol} remaining after this transfer.`
        : `Would be rejected by Aegis: ${mirrored.reason}`,
      networkFee: fee,
      logs,
    };
  }

  async executeAgentTransferSpl(
    recipient: PublicKey,
    token: TokenInfo,
    amount: bigint,
    opts: { skipPreflight?: boolean } = {},
  ): Promise<TransferExecution> {
    const signer = this.agentSigner();
    const policy = await this.getPolicy();
    const now = await this.chainTime();
    const ix = await this.agentTransferSplIx(signer.publicKey, recipient, token, amount);
    const { tx, latestBlockhash } = await this.buildTransaction([ix], signer.publicKey);
    await signer.signTransaction(tx);

    const tokenRemaining = (): bigint =>
      policy.tokenDailyLimit > policy.tokenSpentToday ? policy.tokenDailyLimit - policy.tokenSpentToday : 0n;

    try {
      const sig = await this.conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: Boolean(opts.skipPreflight),
        preflightCommitment: this.config.commitment,
      });
      const confirmation = await this.conn.confirmTransaction(
        { signature: sig, ...latestBlockhash },
        this.config.commitment,
      );
      const logs = await this.logsForSignature(sig);
      const customCode = extractCustomErrorCode(confirmation.value.err, logs);
      const reasonCode = customCode === undefined ? undefined : reasonFromAegisErrorCode(customCode);

      if (reasonCode !== undefined || confirmation.value.err) {
        const check = reasonCode !== undefined
              ? checkTokenFromAegisReason(policy, token, reasonCode, amount, recipient.toBase58(), now)
          : {
              allowed: false,
              reason: "Transaction was rejected by the cluster.",
              spentToday: policy.tokenSpentToday,
              dailyLimit: policy.tokenDailyLimit,
              remaining: tokenRemaining(),
            };
        return { sig, check, status: "rejected", logs };
      }

      return {
        sig,
        check: checkTokenTransferPolicy(policy, token, amount, recipient.toBase58(), now),
        status: "confirmed",
        logs,
      };
    } catch (error) {
      const logs = await logsFromError(error, this.conn);
      const customCode = extractCustomErrorCode(error, logs);
      const reasonCode = customCode === undefined ? undefined : reasonFromAegisErrorCode(customCode);
      const check = reasonCode !== undefined
        ? checkTokenFromAegisReason(policy, token, reasonCode, amount, recipient.toBase58(), now)
        : {
            allowed: false,
            reason: error instanceof Error ? error.message : "Transaction failed",
            spentToday: policy.tokenSpentToday,
            dailyLimit: policy.tokenDailyLimit,
            remaining: tokenRemaining(),
          };
      return { check, status: "rejected", logs };
    }
  }

  async configureToken(args: {
    tokenMint: string;
    tokenMaxPerTx: bigint;
    tokenDailyLimit: bigint;
  }): Promise<string> {
    const owner = requireOwnerKeypair(this.config);
    const policy = this.policyForOwner(owner.publicKey);
    const ix = buildConfigureTokenIx(
      { ...this.addresses({ policy }), owner: owner.publicKey },
      {
        tokenMint: new PublicKey(args.tokenMint),
        tokenMaxPerTx: args.tokenMaxPerTx,
        tokenDailyLimit: args.tokenDailyLimit,
      },
    );
    return this.sendOwnerTransaction([ix], owner);
  }

  async ensureSplTokenAccounts(
    tokenMint: string,
    recipientOwners: PublicKey[] = [],
  ): Promise<TokenAccountSetupResult> {
    const owner = requireOwnerKeypair(this.config);
    const mint = new PublicKey(tokenMint);
    const policy = this.policyForOwner(owner.publicKey);
    const vault = findVaultPda(policy, this.config.programId);
    const vaultTokenAccount = findAssociatedTokenAddress(vault, mint);

    const uniqueRecipientOwners = uniquePublicKeys(recipientOwners);
    const recipientTokenAccounts = uniqueRecipientOwners.map((recipient) => findAssociatedTokenAddress(recipient, mint));
    const accountTargets = [
      { owner: vault, ata: vaultTokenAccount },
      ...uniqueRecipientOwners.map((recipient, index) => ({
        owner: recipient,
        ata: recipientTokenAccounts[index],
      })),
    ];

    const infos = await this.conn.getMultipleAccountsInfo(
      accountTargets.map((target) => target.ata),
      this.config.commitment,
    );
    const missing = accountTargets.filter((_, index) => !infos[index]);
    const existing = accountTargets
      .filter((_, index) => Boolean(infos[index]))
      .map((target) => target.ata.toBase58());

    let sig: string | undefined;
    if (missing.length > 0) {
      const ixs = missing.map((target) => buildCreateAssociatedTokenAccountIdempotentIx({
        payer: owner.publicKey,
        owner: target.owner,
        mint,
        ata: target.ata,
      }));
      sig = await this.sendOwnerTransaction(ixs, owner);
    }

    return {
      mint: mint.toBase58(),
      vaultTokenAccount: vaultTokenAccount.toBase58(),
      recipientTokenAccounts: recipientTokenAccounts.map((ata) => ata.toBase58()),
      created: missing.map((target) => target.ata.toBase58()),
      existing,
      sig,
    };
  }

  async ensureConfiguredTokenAccounts(recipientOwners: PublicKey[] = []): Promise<TokenAccountSetupResult> {
    const policy = await this.getPolicy();
    if (policy.tokenMint === PublicKey.default.toBase58()) {
      throw new PraxisConfigError("Configure the SPL token envelope before preparing token accounts.");
    }
    return this.ensureSplTokenAccounts(policy.tokenMint, recipientOwners);
  }

  async fundTokenVault(tokenMint: string, amount: bigint): Promise<string> {
    const owner = requireOwnerKeypair(this.config);
    const mint = new PublicKey(tokenMint);
    const policy = this.policyForOwner(owner.publicKey);
    const vault = findVaultPda(policy, this.config.programId);
    const ownerTokenAccount = findAssociatedTokenAddress(owner.publicKey, mint);
    const vaultTokenAccount = findAssociatedTokenAddress(vault, mint);

    await this.ensureSplTokenAccounts(tokenMint);
    const createOwnerAta = buildCreateAssociatedTokenAccountIdempotentIx({
      payer: owner.publicKey,
      owner: owner.publicKey,
      mint,
      ata: ownerTokenAccount,
    });
    const transfer = buildTokenTransferIx({
      source: ownerTokenAccount,
      destination: vaultTokenAccount,
      authority: owner.publicKey,
      amount,
    });
    return this.sendOwnerTransaction([createOwnerAta, transfer], owner);
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
    const policy = findPolicyPda(owner.publicKey, this.config.programId);
    const addresses = {
      ...this.addresses({ policy }),
      owner: owner.publicKey,
      agentAuthority: this.agentSigner().publicKey,
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
    return this.sendOwnerAction({ kind: "updatePolicy", patch });
  }

  async updateAllowList(kind: AllowListKind, address: string, mode: "add" | "remove"): Promise<string> {
    return this.sendOwnerAction({ kind: "allowList", listKind: kind, address, mode });
  }

  async revokeAgent(): Promise<string> {
    return this.sendOwnerAction({ kind: "revoke" });
  }

  async rotateAgent(): Promise<string> {
    return this.sendOwnerAction({ kind: "rotate" });
  }

  async bootstrapPolicy(): Promise<string> {
    return this.sendOwnerAction({ kind: "bootstrapPolicy" });
  }

  /**
   * Build the instruction(s) for an owner action against an explicit owner
   * public key (the signed-in WALLET in production, or the backend owner keypair
   * for the local/devnet path). The owner is the sole signer for all of these.
   */
  async ownerActionInstructions(
    ownerPubkey: PublicKey,
    action: OwnerAction,
  ): Promise<TransactionInstruction[]> {
    if (action.kind === "bootstrapPolicy") {
      const policy = findPolicyPda(ownerPubkey, this.config.programId);
      const existing = await this.conn.getAccountInfo(policy, this.config.commitment);
      if (existing) {
        throw new PraxisInputError(`Aegis policy already exists for wallet: ${ownerPubkey.toBase58()}`);
      }

      const addresses = {
        ...this.addresses({ policy }),
        owner: ownerPubkey,
        agentAuthority: this.agentSigner().publicKey,
      };
      const verifiedMints = uniqueStrings(
        this.config.tokens.filter((token) => token.verified).map((token) => token.mint),
      );
      if (verifiedMints.length > MAX_ALLOWED_MINTS) {
        throw new PraxisConfigError(`Bootstrap policy allows at most ${MAX_ALLOWED_MINTS} verified mints.`);
      }
      const initialize = buildInitializePolicyIx(addresses, {
        maxPerTx: BOOTSTRAP_MAX_PER_TX,
        dailyLimit: BOOTSTRAP_DAILY_LIMIT,
        allowedPrograms: [
          SYSTEM_PROGRAM_ID.toBase58(),
          TOKEN_PROGRAM_ID.toBase58(),
          JUPITER_PROGRAM_ID.toBase58(),
        ],
        allowedRecipients: [],
        allowedMints: verifiedMints,
        expiryTs: (await this.chainTime()) + BOOTSTRAP_POLICY_TTL_SECONDS,
      });
      const fund = buildFundVaultIx({ ...addresses, owner: ownerPubkey }, BOOTSTRAP_VAULT_FUNDING);
      return [initialize, fund];
    }

    if (action.kind === "revoke") {
      const policy = this.policyForOwner(ownerPubkey);
      return [buildRevokeAgentIx({ ...this.addresses({ policy }), owner: ownerPubkey })];
    }

    if (action.kind === "rotate") {
      const nextAgent = resolveNextAgentPublicKey(this.config.nextAgentKeypair);
      if (!nextAgent) {
        throw new PraxisConfigError(
          "Rotate requires the next agent key: set PRAXIS_NEXT_AGENT_PUBLIC_KEY (remote custody) or PRAXIS_NEXT_AGENT_KEYPAIR / PRAXIS_NEXT_AGENT_KEYPAIR_PATH.",
        );
      }
      if (this.agentSigner().publicKey.equals(nextAgent)) {
        throw new PraxisConfigError(
          "The next agent key must be different from the current agent key before rotating.",
        );
      }
      const policy = this.policyForOwner(ownerPubkey);
      return [buildRotateAgentIx({ ...this.addresses({ policy }), owner: ownerPubkey }, nextAgent)];
    }

    const current = await this.getPolicy();
    const policy = new PublicKey(current.address);
    const base = {
      maxPerTx: current.maxPerTx,
      dailyLimit: current.dailyLimit,
      allowedPrograms: current.allowedPrograms,
      allowedRecipients: current.allowedRecipients,
      allowedMints: current.allowedMints,
      expiryTs: current.expiryTs,
      paused: current.paused,
    };

    if (action.kind === "updatePolicy") {
      return [
        buildUpdatePolicyIx({ ...this.addresses({ policy }), owner: ownerPubkey }, {
          ...base,
          maxPerTx: action.patch.maxPerTx ?? current.maxPerTx,
          dailyLimit: action.patch.dailyLimit ?? current.dailyLimit,
          expiryTs: action.patch.expiryTs ?? current.expiryTs,
          paused: action.patch.paused ?? current.paused,
        }),
      ];
    }

    const normalizedAddress = validatePublicKey(action.address).toBase58();
    const field =
      action.listKind === "programs"
        ? "allowedPrograms"
        : action.listKind === "recipients"
          ? "allowedRecipients"
          : "allowedMints";
    const next = new Set(current[field]);
    if (action.mode === "add") next.add(normalizedAddress);
    else next.delete(normalizedAddress);

    return [
      buildUpdatePolicyIx({ ...this.addresses({ policy }), owner: ownerPubkey }, {
        ...base,
        allowedPrograms: field === "allowedPrograms" ? [...next] : current.allowedPrograms,
        allowedRecipients: field === "allowedRecipients" ? [...next] : current.allowedRecipients,
        allowedMints: field === "allowedMints" ? [...next] : current.allowedMints,
      }),
    ];
  }

  /** Build an UNSIGNED owner transaction for the wallet to sign (production custody). */
  async buildUnsignedOwnerTransaction(
    ownerPubkey: PublicKey,
    action: OwnerAction,
  ): Promise<UnsignedOwnerTransaction> {
    const instructions = await this.ownerActionInstructions(ownerPubkey, action);
    const { tx, latestBlockhash } = await this.buildTransaction(instructions, ownerPubkey);
    return {
      transaction: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    };
  }

  /** Submit a wallet-signed owner transaction and wait for confirmation. */
  async submitSignedTransaction(
    input: UnsignedOwnerTransaction,
    opts: { expectedFeePayer?: PublicKey } = {},
  ): Promise<string> {
    const raw = Buffer.from(input.transaction, "base64");
    if (opts.expectedFeePayer) {
      let tx: Transaction;
      try {
        tx = Transaction.from(Uint8Array.from(raw));
      } catch {
        throw new PraxisInputError("Signed owner transaction must be a valid legacy Solana transaction.");
      }
      if (!tx.feePayer?.equals(opts.expectedFeePayer)) {
        throw new PraxisInputError("Signed owner transaction fee payer does not match the authenticated wallet.");
      }
      if (tx.recentBlockhash !== input.blockhash) {
        throw new PraxisInputError("Signed owner transaction blockhash does not match the unsigned draft.");
      }
    }
    const sig = await this.conn.sendRawTransaction(raw, {
      preflightCommitment: this.config.commitment,
    });
    const confirmation = await this.conn.confirmTransaction(
      { signature: sig, blockhash: input.blockhash, lastValidBlockHeight: input.lastValidBlockHeight },
      this.config.commitment,
    );
    if (confirmation.value.err) {
      throw new Error(`owner transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    return sig;
  }

  private async sendOwnerAction(action: OwnerAction): Promise<string> {
    const owner = requireOwnerKeypair(this.config);
    const instructions = await this.ownerActionInstructions(owner.publicKey, action);
    return this.sendOwnerTransaction(instructions, owner);
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

  private async agentTransferSplIx(
    agentAuthority: PublicKey,
    recipient: PublicKey,
    token: TokenInfo,
    amount: bigint,
  ): Promise<TransactionInstruction> {
    const policy = requirePolicyAddress(this.config);
    const mint = new PublicKey(token.mint);
    const vault = findVaultPda(policy, this.config.programId);
    return buildAgentTransferSplIx(
      { ...this.addresses({ policy }), agentAuthority },
      {
        vaultTokenAccount: findAssociatedTokenAddress(vault, mint),
        recipientTokenAccount: findAssociatedTokenAddress(recipient, mint),
      },
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
  ): Promise<BuiltTransaction> {
    const latest = await this.conn.getLatestBlockhash(this.config.commitment);
    return {
      tx: new Transaction({
        feePayer,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      }).add(...instructions),
      latestBlockhash: latest,
    };
  }

  private async sendOwnerTransaction(instructions: TransactionInstruction[], owner: Keypair): Promise<string> {
    const { tx, latestBlockhash } = await this.buildTransaction(instructions, owner.publicKey);
    tx.sign(owner);
    const sig = await this.conn.sendRawTransaction(tx.serialize(), {
      preflightCommitment: this.config.commitment,
    });
    const confirmation = await this.conn.confirmTransaction(
      { signature: sig, ...latestBlockhash },
      this.config.commitment,
    );
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

function uniquePublicKeys(values: PublicKey[]): PublicKey[] {
  const out: PublicKey[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toBase58();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
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
