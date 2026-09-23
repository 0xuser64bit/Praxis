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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  JUPITER_PROGRAM_ID,
  reasonFromAegisErrorCode,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants";
import { decodeActionLog, decodePolicyAccount } from "./codec";
import { assertMatchesOwnerDraft, issueOwnerDraftToken } from "./ownerDraft";
import { checkMintMovable, resolveMintInfo, supportedTokenPrograms } from "../stocks/mintDecimals";
import {
  buildAgentTransferIx,
  buildAgentTransferSplIx,
  buildConfigureTokenIx,
  buildCreateAssociatedTokenAccountIdempotentIx,
  buildClosePolicyIx,
  buildFundVaultIx,
  buildWithdrawVaultIx,
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
  LocalKeypairSigner,
  requireAgentSigner,
  resolveNextAgentPublicKey,
  type AgentSigner,
} from "../agent/agentSigner";
import {
  PraxisConfigError,
  PraxisInputError,
  PraxisPolicyNotFoundError,
} from "../errors";
import {
  checkFromAegisReason,
  checkTokenFromAegisReason,
  checkTokenTransferPolicy,
  checkTransferPolicy,
  effectiveSpentToday,
  effectiveTokenSpentToday,
} from "../agent/policy";
import type { ActionLogEntry, PolicyCheckResult, TokenInfo } from "@praxis/shared";
import { remaining } from "@praxis/shared";
import { formatSol, formatUnits, parseHumanUnits, SOL_DECIMALS } from "../units";
import { envTimeout, withTimeout } from "../api/timeout";
import { errorFields, logger } from "../observability/logger";

/**
 * An owner/admin policy action. Built server-side as an unsigned transaction the
 * owner WALLET signs (production custody), or sent directly by the backend owner
 * keypair (local/devnet fallback).
 */
export type OwnerAction =
  | { kind: "bootstrapPolicy"; fundLamports?: bigint }
  | { kind: "fundVault"; amount: bigint }
  | { kind: "withdrawVault"; amount: bigint }
  | { kind: "closePolicy" }
  | { kind: "updatePolicy"; patch: PolicyUpdate }
  | { kind: "allowList"; listKind: AllowListKind; address: string; mode: "add" | "remove" }
  | { kind: "revoke" }
  | { kind: "rotate" }
  | {
      kind: "configureToken";
      tokenMint: string;
      tokenMaxPerTx: bigint;
      tokenDailyLimit: bigint;
    }
  | { kind: "prepareTokenAccounts"; recipientAddresses?: string[] };

/** A serialized unsigned owner transaction plus the blockhash to confirm it. */
export interface UnsignedOwnerTransaction {
  /** base64-encoded, unsigned legacy transaction with feePayer = owner wallet. */
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  /**
   * Opaque, backend-signed fingerprint of this draft. Echo it back verbatim on
   * submit — it is what proves the signed bytes are the ones Praxis built, and
   * therefore that the server-side preconditions for this action actually ran.
   * See `ownerDraft.ts`.
   */
  draft: string;
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

const connections = new Map<string, Connection>();

function connectionKey(url: string, commitment: string): string {
  return `${url}::${commitment}`;
}

export function getConnection(config = getServerConfig()): Connection {
  const key = connectionKey(config.rpcUrl, config.commitment);
  let connection = connections.get(key);
  if (!connection) {
    connection = new Connection(config.rpcUrl, config.commitment);
    connections.set(key, connection);
  }
  return connection;
}

/** Read-only connection for token research. Defaults to mainnet-beta because the
 *  configured tokens are mainnet mints, independent of where transfers execute. */
export function getResearchConnection(config = getServerConfig()): Connection {
  const key = connectionKey(config.researchRpcUrl, config.commitment);
  let researchConnection = connections.get(key);
  if (!researchConnection) {
    researchConnection = new Connection(config.researchRpcUrl, config.commitment);
    connections.set(key, researchConnection);
  }
  return researchConnection;
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
   * Sign with whichever locally-held key the chain currently authorizes.
   *
   * `agent_transfer` enforces `signer == policy.agent_authority` on-chain. After
   * a `rotate_agent` (the "re-enable agent" / key-rotation flow) the authority
   * becomes the NEXT key, so the backend must start signing with that key —
   * otherwise every transfer fails `invalid_agent_authority`. Because the chain
   * is the source of truth, we pick the matching held keypair instead of caching
   * a single fixed signer; this makes rotation work with no extra state.
   *
   * Remote custody (PRAXIS_AGENT_SIGNER_URL) is never overridden — its single
   * key boundary is preserved and we defer to {@link agentSigner}.
   */
  private activeAgentSigner(policy: PolicyView): AgentSigner {
    if (!process.env.PRAXIS_AGENT_SIGNER_URL?.trim()) {
      const authority = policy.agentAuthority;
      for (const keypair of [this.config.agentKeypair, this.config.nextAgentKeypair]) {
        if (keypair && keypair.publicKey.toBase58() === authority) {
          return new LocalKeypairSigner(keypair);
        }
      }
    }
    return this.agentSigner();
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
      // Fail CLOSED on vault-balance RPC faults: masking as 0 would render an
      // empty vault and invite a double-fund. A throw surfaces as an error
      // state instead of a wrong zero.
      this.conn.getBalance(vaultAddress, this.config.commitment),
    ]);

    if (!policyInfo) {
      // A first-run wallet, not a fault: the typed `policy_not_found` code is
      // what drives vault onboarding in the client.
      throw new PraxisPolicyNotFoundError(policyAddress.toBase58());
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
    const policy = await this.getPolicy();
    const signer = this.activeAgentSigner(policy);
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
    const policy = await this.getPolicy();
    const signer = this.activeAgentSigner(policy);
    const now = await this.chainTime();
    const ix = await this.agentTransferIx(signer.publicKey, recipient, amount);
    const { tx, latestBlockhash } = await this.buildTransaction([ix], signer.publicKey);
    await signer.signTransaction(tx);

    try {
      const { sig, confirmation } = await this.sendAndConfirm(tx.serialize(), latestBlockhash, opts);
      const logs = await this.logsForSignature(sig);
      const customCode = extractCustomErrorCode(confirmation.value.err, logs);
      const reasonCode = customCode === undefined ? undefined : reasonFromAegisErrorCode(customCode);

      if (reasonCode !== undefined || confirmation.value.err) {
        const check = reasonCode !== undefined
          ? checkFromAegisReason(policy, reasonCode, amount, recipient.toBase58(), now)
          : fallbackTransferCheck(policy, now, "Transaction was rejected by the cluster.");
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
        : fallbackTransferCheck(
            policy,
            now,
            error instanceof Error ? error.message : "Transaction failed",
          );
      return { check, status: "rejected", logs };
    }
  }

  async simulateAgentTransferSpl(
    recipient: PublicKey,
    token: TokenInfo,
    amount: bigint,
  ): Promise<TransferSimulation> {
    const policy = await this.getPolicy();
    const signer = this.activeAgentSigner(policy);
    const now = await this.chainTime();
    const recipientAddress = recipient.toBase58();
    const mirrored = checkTokenTransferPolicy(policy, token, amount, recipientAddress, now);

    // A missing token account surfaces from the program as "account is not a
    // valid SPL token account for the configured mint" — technically true and
    // completely unactionable. Name which account is missing and what fixes
    // it, before spending a simulation round-trip on it.
    const missing = await this.missingTokenAccounts(recipient, token);
    if (missing) {
      return {
        check: { ...mirrored, allowed: false, reason: missing },
        simulation: "Blocked before simulation: a token account is missing.",
        networkFee: 0n,
        logs: [],
      };
    }
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
    const policy = await this.getPolicy();
    const signer = this.activeAgentSigner(policy);
    const now = await this.chainTime();
    const ix = await this.agentTransferSplIx(signer.publicKey, recipient, token, amount);
    const { tx, latestBlockhash } = await this.buildTransaction([ix], signer.publicKey);
    await signer.signTransaction(tx);

    try {
      const { sig, confirmation } = await this.sendAndConfirm(tx.serialize(), latestBlockhash, opts);
      const logs = await this.logsForSignature(sig);
      const customCode = extractCustomErrorCode(confirmation.value.err, logs);
      const reasonCode = customCode === undefined ? undefined : reasonFromAegisErrorCode(customCode);

      if (reasonCode !== undefined || confirmation.value.err) {
        const check = reasonCode !== undefined
          ? checkTokenFromAegisReason(policy, token, reasonCode, amount, recipient.toBase58(), now)
          : fallbackTokenTransferCheck(policy, now, "Transaction was rejected by the cluster.");
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
        : fallbackTokenTransferCheck(
            policy,
            now,
            error instanceof Error ? error.message : "Transaction failed",
          );
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
    const { programId } = await this.tokenProgramFor(mint);
    const policy = this.policyForOwner(owner.publicKey);
    const vault = findVaultPda(policy, this.config.programId);
    const vaultTokenAccount = findAssociatedTokenAddress(vault, mint, programId);

    const uniqueRecipientOwners = uniquePublicKeys(recipientOwners);
    const recipientTokenAccounts = uniqueRecipientOwners.map((recipient) =>
      findAssociatedTokenAddress(recipient, mint, programId),
    );
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
        tokenProgramId: programId,
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
    const { programId, decimals } = await this.tokenProgramFor(mint);
    if (decimals === undefined) {
      throw new PraxisInputError(`Could not read mint ${tokenMint} on this cluster.`);
    }
    const policy = this.policyForOwner(owner.publicKey);
    const vault = findVaultPda(policy, this.config.programId);
    const ownerTokenAccount = findAssociatedTokenAddress(owner.publicKey, mint, programId);
    const vaultTokenAccount = findAssociatedTokenAddress(vault, mint, programId);

    await this.ensureSplTokenAccounts(tokenMint);
    const createOwnerAta = buildCreateAssociatedTokenAccountIdempotentIx({
      payer: owner.publicKey,
      owner: owner.publicKey,
      mint,
      ata: ownerTokenAccount,
      tokenProgramId: programId,
    });
    const transfer = buildTokenTransferIx({
      source: ownerTokenAccount,
      destination: vaultTokenAccount,
      authority: owner.publicKey,
      mint,
      decimals,
      amount,
      tokenProgramId: programId,
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

  async withdrawVault(amount: bigint): Promise<string> {
    const owner = requireOwnerKeypair(this.config);
    const policy = this.policyForOwner(owner.publicKey);
    const ix = buildWithdrawVaultIx({ ...this.addresses({ policy }), owner: owner.publicKey }, amount);
    return this.sendOwnerTransaction([ix], owner);
  }

  async closePolicy(): Promise<string> {
    const owner = requireOwnerKeypair(this.config);
    await this.assertVaultTokensCleared();
    const policy = this.policyForOwner(owner.publicKey);
    const ix = buildClosePolicyIx({ ...this.addresses({ policy }), owner: owner.publicKey });
    return this.sendOwnerTransaction([ix], owner);
  }

  /**
   * Phase-1 teardown is SOL-only. If a token envelope is configured and its
   * vault token account still holds a balance, refuse to close so the tokens
   * are never silently stranded (token sweep is a follow-up). SPL token account
   * layout: amount is a u64 LE at byte offset 64.
   */
  private async assertVaultTokensCleared(): Promise<void> {
    const policy = await this.getPolicy();
    if (policy.tokenMint === PublicKey.default.toBase58()) return;
    const vault = findVaultPda(new PublicKey(policy.address), this.config.programId);
    const mint = new PublicKey(policy.tokenMint);
    const { programId } = await this.tokenProgramFor(mint);
    const vaultTokenAccount = findAssociatedTokenAddress(vault, mint, programId);
    const info = await this.conn.getAccountInfo(vaultTokenAccount, this.config.commitment);
    if (!info) return;
    // SPL token account layout: amount is a u64 LE at byte offset 64 (165-byte
    // account). Guard length so a short/malformed account throws InputError,
    // not a RangeError 500.
    if (info.data.length < 72) {
      throw new PraxisInputError("Vault token account has unexpected layout; refusing teardown.");
    }
    const balance = info.data.readBigUInt64LE(64);
    if (balance > 0n) {
      throw new PraxisInputError(
        "Move your SPL tokens out of the vault before deleting your agent (SOL-only teardown for now).",
      );
    }
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

  async bootstrapPolicy(fundLamports: bigint = BOOTSTRAP_VAULT_FUNDING): Promise<string> {
    return this.sendOwnerAction({ kind: "bootstrapPolicy", fundLamports });
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
      const fundLamports = action.fundLamports ?? 0n;
      if (fundLamports > 0n) {
        const fund = buildFundVaultIx({ ...addresses, owner: ownerPubkey }, fundLamports);
        return [initialize, fund];
      }
      return [initialize];
    }

    if (action.kind === "fundVault") {
      if (action.amount <= 0n) {
        throw new PraxisInputError("Fund amount must be greater than zero.");
      }
      const policy = this.policyForOwner(ownerPubkey);
      return [buildFundVaultIx({ ...this.addresses({ policy }), owner: ownerPubkey }, action.amount)];
    }

    if (action.kind === "withdrawVault") {
      if (action.amount <= 0n) {
        throw new PraxisInputError("Withdraw amount must be greater than zero.");
      }
      const policy = this.policyForOwner(ownerPubkey);
      return [buildWithdrawVaultIx({ ...this.addresses({ policy }), owner: ownerPubkey }, action.amount)];
    }

    if (action.kind === "closePolicy") {
      await this.assertVaultTokensCleared();
      const policy = this.policyForOwner(ownerPubkey);
      return [buildClosePolicyIx({ ...this.addresses({ policy }), owner: ownerPubkey })];
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

    if (action.kind === "configureToken") {
      if (action.tokenMaxPerTx <= 0n || action.tokenDailyLimit <= 0n) {
        throw new PraxisInputError("Token caps must be greater than zero.");
      }
      if (action.tokenMaxPerTx > action.tokenDailyLimit) {
        throw new PraxisInputError("Token per-transaction cap cannot exceed the token daily limit.");
      }
      const mint = validatePublicKey(action.tokenMint);
      await this.assertMintMovable(mint);
      const configure = buildConfigureTokenIx(
        { ...this.addresses({ policy }), owner: ownerPubkey },
        {
          tokenMint: mint,
          tokenMaxPerTx: action.tokenMaxPerTx,
          tokenDailyLimit: action.tokenDailyLimit,
        },
      );
      // Also create the vault's and the owner's own ATA when missing: the vault
      // so the agent can move tokens at once, the owner because a bare
      // "buy $40 openai" settles into the owner's wallet — without it the
      // headline buy is refused for a missing recipient account.
      const vault = findVaultPda(policy, this.config.programId);
      const ataIxs = await this.missingAtaCreateInstructions(ownerPubkey, mint, [vault, ownerPubkey]);
      return [configure, ...ataIxs];
    }

    if (action.kind === "prepareTokenAccounts") {
      const mintBase58 = current.tokenMint;
      if (mintBase58 === PublicKey.default.toBase58()) {
        throw new PraxisInputError("Configure the SPL token envelope before preparing token accounts.");
      }
      const mint = new PublicKey(mintBase58);
      const vault = findVaultPda(policy, this.config.programId);
      const recipients = uniquePublicKeys(
        (action.recipientAddresses ?? []).map((address) => validatePublicKey(address)),
      );
      // The owner's own wallet is the default buy destination, so it is always
      // a recipient worth preparing, address book or not.
      const ixs = await this.missingAtaCreateInstructions(ownerPubkey, mint, [vault, ownerPubkey, ...recipients]);
      if (ixs.length === 0) {
        throw new PraxisInputError("All required token accounts already exist.");
      }
      return ixs;
    }

    if (action.kind !== "allowList") {
      throw new PraxisInputError(`Unsupported owner action kind: ${(action as { kind: string }).kind}`);
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

  /**
   * Refuse an envelope for a mint `agent_transfer_spl` could never move.
   *
   * The instruction can drive SPL Token or Token-2022; anything else produces
   * a policy whose agent transfers can only ever fail, plus an ATA create that
   * reverts. Catch it while it is still a readable error instead of an
   * on-chain rejection the owner paid fees for.
   */
  private async assertMintMovable(mint: PublicKey): Promise<void> {
    if (process.env.PRAXIS_ALLOW_UNVERIFIED_MINTS === "1") return;
    const verdict = await checkMintMovable(
      this.conn,
      mint.toBase58(),
      supportedTokenPrograms(TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()),
    );
    if (verdict.movable) return;
    if (verdict.reason === "wrong-token-program") {
      throw new PraxisInputError(
        `This mint is owned by ${verdict.programId}, which is neither SPL Token nor Token-2022. ` +
          "Configuring it would create an envelope the agent could never use.",
      );
    }
    throw new PraxisInputError(
      "This mint could not be found on the cluster Praxis transfers on, so its envelope cannot be configured.",
    );
  }

  /**
   * Idempotent ATA creates for any of `accountOwners` whose ATA is missing.
   * Fee payer is the owner wallet (or backend owner key).
   */
  private async missingAtaCreateInstructions(
    payer: PublicKey,
    mint: PublicKey,
    accountOwners: PublicKey[],
  ): Promise<TransactionInstruction[]> {
    const { programId } = await this.tokenProgramFor(mint);
    const targets = uniquePublicKeys(accountOwners).map((owner) => ({
      owner,
      ata: findAssociatedTokenAddress(owner, mint, programId),
    }));
    if (targets.length === 0) return [];

    const infos = await this.conn.getMultipleAccountsInfo(
      targets.map((target) => target.ata),
      this.config.commitment,
    );
    return targets
      .filter((_, index) => !infos[index])
      .map((target) =>
        buildCreateAssociatedTokenAccountIdempotentIx({
          payer,
          owner: target.owner,
          mint,
          ata: target.ata,
          tokenProgramId: programId,
        }),
      );
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
      draft: issueOwnerDraftToken(ownerPubkey, tx),
    };
  }

  /** Submit a wallet-signed owner transaction and wait for confirmation. */
  async submitSignedTransaction(
    input: UnsignedOwnerTransaction,
    owner: PublicKey,
  ): Promise<string> {
    const raw = Buffer.from(input.transaction, "base64");
    this.assertSubmittableOwnerTransaction(raw, input, owner);
    // Bounded like every other submit path (see sendAndConfirm): a hung RPC
    // must not hold a serverless function open until the platform kills it.
    const sig = await withTimeout(
      this.conn.sendRawTransaction(raw, { preflightCommitment: this.config.commitment }),
      envTimeout("PRAXIS_RPC_READ_TIMEOUT_MS", 8000),
      "sendRawTransaction (owner)",
    );
    const confirmation = await withTimeout(
      this.conn.confirmTransaction(
        { signature: sig, blockhash: input.blockhash, lastValidBlockHeight: input.lastValidBlockHeight },
        this.config.commitment,
      ),
      60_000,
      "confirmTransaction (owner)",
    );
    if (confirmation.value.err) {
      throw new Error(`owner transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    return sig;
  }

  /**
   * Gate a wallet-signed owner transaction before the backend relays it.
   *
   * Two things have to hold. The instructions must belong to the small set the
   * owner-action builder emits (Aegis, ATA CreateIdempotent) plus the
   * ComputeBudget priority-fee instructions wallets legitimately append —
   * otherwise the backend is an open relay. And the transaction must be the
   * draft Praxis itself built ({@link assertMatchesOwnerDraft}), which is what
   * keeps the server-side preconditions in `ownerActionInstructions` from being
   * optional. On-chain `has_one = owner` remains the enforcement of record.
   */
  private assertSubmittableOwnerTransaction(
    raw: Buffer,
    input: UnsignedOwnerTransaction,
    expectedFeePayer: PublicKey,
  ): void {
    let tx: Transaction;
    try {
      tx = Transaction.from(Uint8Array.from(raw));
    } catch {
      throw new PraxisInputError("Signed owner transaction must be a valid legacy Solana transaction.");
    }

    if (tx.instructions.length === 0) {
      throw new PraxisInputError("Signed owner transaction has no instructions.");
    }
    for (const ix of tx.instructions) {
      if (ix.programId.equals(this.config.programId)) continue;
      if (isAssociatedTokenCreateIdempotent(ix)) continue;
      if (isWalletPriorityFeeIx(ix)) continue;
      throw new PraxisInputError(
        "Signed owner transaction may only contain Aegis instructions, ATA CreateIdempotent, " +
          `or ComputeBudget priority-fee instructions (blocked program ${ix.programId.toBase58()}).`,
      );
    }

    if (!tx.feePayer?.equals(expectedFeePayer)) {
      throw new PraxisInputError("Signed owner transaction fee payer does not match the authenticated wallet.");
    }
    assertMatchesOwnerDraft(input.draft, tx, expectedFeePayer);
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

  /**
   * Which side of an SPL transfer has no token account yet, as a sentence the
   * owner can act on. Returns undefined when both exist.
   */
  private async missingTokenAccounts(
    recipient: PublicKey,
    token: TokenInfo,
  ): Promise<string | undefined> {
    const policy = requirePolicyAddress(this.config);
    const mint = new PublicKey(token.mint);
    const vault = findVaultPda(policy, this.config.programId);
    const { programId } = await this.tokenProgramFor(mint);
    const vaultAta = findAssociatedTokenAddress(vault, mint, programId);
    const recipientAta = findAssociatedTokenAddress(recipient, mint, programId);

    const [vaultInfo, recipientInfo] = await this.conn.getMultipleAccountsInfo(
      [vaultAta, recipientAta],
      this.config.commitment,
    );
    if (!vaultInfo) {
      return (
        `Your vault has no ${token.symbol} account yet, so there is nothing to send. ` +
        "Open Policy → Token transfers and choose the token, or run prepare accounts."
      );
    }
    if (!recipientInfo) {
      return (
        `The recipient has no ${token.symbol} account yet, so the transfer would fail. ` +
        "Open Policy → Token transfers → prepare accounts to create it (you pay the rent)."
      );
    }
    return undefined;
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
    const { programId } = await this.tokenProgramFor(mint);
    return buildAgentTransferSplIx(
      { ...this.addresses({ policy }), agentAuthority },
      {
        vaultTokenAccount: findAssociatedTokenAddress(vault, mint, programId),
        recipientTokenAccount: findAssociatedTokenAddress(recipient, mint, programId),
        mint,
        tokenProgramId: programId,
      },
      amount,
    );
  }

  /**
   * The token program that owns `mint`, and its decimals.
   *
   * Everything downstream depends on getting this right: the ATA address is
   * derived from the program id, and the on-chain handler requires the
   * accounts, the mint and the invoked program to agree. Defaults to classic
   * SPL only when the mint cannot be read, which keeps behaviour unchanged for
   * the classic path and surfaces Token-2022 problems as an explicit failure
   * rather than a silently wrong address.
   */
  private async tokenProgramFor(mint: PublicKey): Promise<{ programId: PublicKey; decimals?: number }> {
    const info = await resolveMintInfo(this.conn, mint.toBase58());
    if (!info) return { programId: TOKEN_PROGRAM_ID };
    const programId = info.programId === TOKEN_2022_PROGRAM_ID.toBase58()
      ? TOKEN_2022_PROGRAM_ID
      : new PublicKey(info.programId);
    return { programId, decimals: info.decimals };
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

  /**
   * Send a signed transaction and wait for confirmation with bounded timeouts
   * so a hung RPC never hangs a Next.js function indefinitely.
   */
  private async sendAndConfirm(
    raw: Uint8Array,
    latestBlockhash: { blockhash: string; lastValidBlockHeight: number },
    opts: { skipPreflight?: boolean } = {},
  ): Promise<{ sig: string; confirmation: Awaited<ReturnType<Connection["confirmTransaction"]>> }> {
    const sendMs = envTimeout("PRAXIS_RPC_READ_TIMEOUT_MS", 8000);
    const sig = await withTimeout(
      this.conn.sendRawTransaction(raw, {
        skipPreflight: Boolean(opts.skipPreflight),
        preflightCommitment: this.config.commitment,
      }),
      sendMs,
      "sendRawTransaction",
    );
    const confirmation = await withTimeout(
      this.conn.confirmTransaction({ signature: sig, ...latestBlockhash }, this.config.commitment),
      60_000,
      "confirmTransaction",
    );
    return { sig, confirmation };
  }

  private async sendOwnerTransaction(instructions: TransactionInstruction[], owner: Keypair): Promise<string> {
    const { tx, latestBlockhash } = await this.buildTransaction(instructions, owner.publicKey);
    tx.sign(owner);
    const { sig, confirmation } = await this.sendAndConfirm(tx.serialize(), latestBlockhash);
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
    const ms = envTimeout("PRAXIS_RPC_READ_TIMEOUT_MS", 8000);
    try {
      const slot = await withTimeout(this.conn.getSlot(this.config.commitment), ms, "getSlot");
      const blockTime = await withTimeout(
        this.conn.getBlockTime(slot),
        ms,
        "getBlockTime",
      );
      if (typeof blockTime === "number") return blockTime;
    } catch (error) {
      logger.warn("aegis.chain_time_fallback", errorFields(error));
    }
    return Math.floor(Date.now() / 1000);
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

/** True for SPL ATA program CreateIdempotent (discriminator byte `1`). */
function isAssociatedTokenCreateIdempotent(ix: TransactionInstruction): boolean {
  if (!ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) return false;
  // CreateIdempotent is a single-byte instruction: [1].
  return ix.data.length === 1 && ix.data[0] === 1;
}

/**
 * Wallet-appended ComputeBudget priority-fee instructions. Layouts per the
 * ComputeBudget program: SetComputeUnitLimit is `[2, units:u32]` (5 bytes),
 * SetComputeUnitPrice is `[3, microLamports:u64]` (9 bytes). Only these two
 * wallet-emitted variants pass — never a blank check for the program id.
 */
function isWalletPriorityFeeIx(ix: TransactionInstruction): boolean {
  if (!ix.programId.equals(COMPUTE_BUDGET_PROGRAM_ID)) return false;
  if (ix.data.length === 5 && ix.data[0] === 2) return true;
  if (ix.data.length === 9 && ix.data[0] === 3) return true;
  return false;
}

/** Cluster-level rejection with no Aegis reason code — still honor the day window. */
function fallbackTransferCheck(policy: PolicyView, now: number, reason: string): PolicyCheckResult {
  const spentToday = effectiveSpentToday(policy, now);
  return {
    allowed: false,
    reason,
    spentToday,
    dailyLimit: policy.dailyLimit,
    remaining: remaining(policy.dailyLimit, spentToday),
  };
}

function fallbackTokenTransferCheck(policy: PolicyView, now: number, reason: string): PolicyCheckResult {
  const spentToday = effectiveTokenSpentToday(policy, now);
  return {
    allowed: false,
    reason,
    spentToday,
    dailyLimit: policy.tokenDailyLimit,
    remaining: remaining(policy.tokenDailyLimit, spentToday),
  };
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

/**
 * The Anchor error code behind a failure, from the structured error when there
 * is one and from the program logs when there is not.
 *
 * Only ever called on a failure: scanning the logs of a SUCCESSFUL transaction
 * would let any string a program happened to log ("Error Number: 6003") be
 * reported to the owner as an Aegis rejection of a transfer that in fact
 * landed.
 */
function extractCustomErrorCode(errorLike: unknown, logs: string[] = []): number | undefined {
  if (errorLike === null || errorLike === undefined) return undefined;

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
