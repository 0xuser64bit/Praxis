import { PublicKey } from "@solana/web3.js";
import {
  ActionKind,
  type ActionProposal,
  type ActivityEntry,
  type AddressBookEntry,
  type AgentBlock,
  type AllowListKind,
  type Message,
  type PolicyUpdate,
  type PolicyView,
  type PraxisProvider,
  type Thread,
  type TokenEnvelopeConfig,
  type TokenInfo,
} from "@praxis/shared";

import {
  AegisClient,
  type OwnerAction,
  type UnsignedOwnerTransaction,
} from "../aegis/client";
import { JUPITER_PROGRAM_ID } from "../aegis/constants";
import { AddressBook } from "../agent/addressBook";
import { checkSwapPolicy } from "../agent/policy";
import {
  parseIntentLocallyForDemo,
  parseIntentWithGemini,
  type ParsedAction,
  type ParsedIntent,
} from "../agent/intent";
import { researchToken } from "../agent/research";
import { getConnection, getResearchConnection } from "../aegis/client";
import {
  configForWalletOwner,
  getServerConfig,
  validatePublicKey,
  type PraxisServerConfig,
} from "../env";
import { PraxisConfigError, PraxisNotFoundError } from "../errors";
import { parseHumanUnits, SOL_DECIMALS } from "../units";
import { getStateRepository, type StateRepository } from "./stateRepository";
import type { StoredProviderState } from "./stateSerialization";
import { errorFields, logger } from "../observability/logger";

interface StoreState {
  threads: Thread[];
  proposals: Record<string, ActionProposal>;
  activity: ActivityEntry[];
  policy?: PolicyView;
  thinking: Record<string, boolean>;
}

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

let singleton: PraxisServerProvider | undefined;
const providersByWallet = new Map<string, PraxisServerProvider>();
const inflightByWallet = new Map<string, Promise<PraxisServerProvider>>();

function ownerKeyForConfig(config: PraxisServerConfig): string {
  return config.ownerAddress?.toBase58() ?? config.policyAddress?.toBase58() ?? "default";
}

/**
 * Acquire the cached provider for a wallet, hydrating its durable state from the
 * configured {@link StateRepository} on first acquisition. Async because a
 * managed-database backend loads over the network; in-flight loads are coalesced
 * so concurrent requests for the same wallet share one hydration.
 */
export async function getPraxisServerProvider(walletAddress?: string): Promise<PraxisServerProvider> {
  const repository = getStateRepository();

  if (walletAddress) {
    const normalized = validatePublicKey(walletAddress, "walletAddress").toBase58();
    const existing = providersByWallet.get(normalized);
    if (existing) return existing;
    const inflight = inflightByWallet.get(normalized);
    if (inflight) return inflight;

    const promise = (async () => {
      const config = configForWalletOwner(new PublicKey(normalized));
      const stored = await repository.load(ownerKeyForConfig(config));
      const provider = new PraxisServerProvider(config, new AegisClient(config), stored);
      providersByWallet.set(normalized, provider);
      return provider;
    })().finally(() => inflightByWallet.delete(normalized));

    inflightByWallet.set(normalized, promise);
    return promise;
  }

  if (!singleton) {
    const config = getServerConfig();
    const stored = await repository.load(ownerKeyForConfig(config));
    singleton = new PraxisServerProvider(config, new AegisClient(config), stored);
  }
  return singleton;
}

export function resetPraxisServerProviderForTests() {
  singleton = undefined;
  providersByWallet.clear();
  inflightByWallet.clear();
}

export class PraxisServerProvider implements PraxisProvider {
  private readonly config: PraxisServerConfig;
  private readonly aegis: AegisClient;
  private readonly addressBook: AddressBook;
  private readonly ownerKey: string;
  private readonly repository: StateRepository;
  private readonly listeners = new Set<() => void>();
  private state: StoreState;
  private version = 0;

  constructor(
    config = getServerConfig(),
    aegis = new AegisClient(config),
    initialState?: StoredProviderState,
  ) {
    this.config = config;
    this.aegis = aegis;
    this.repository = getStateRepository();
    this.addressBook = new AddressBook(config.addressBook);
    this.ownerKey = ownerKeyForConfig(config);
    this.state = {
      threads: initialState?.threads.length ? initialState.threads : [welcomeThread(nowSeconds())],
      proposals: initialState?.proposals ?? {},
      activity: initialState?.activity ?? [],
      thinking: {},
    };
  }

  // --- refresh ---
  async refreshPolicy(): Promise<PolicyView> {
    const policy = await this.aegis.getPolicy();
    this.state.policy = policy;
    return policy;
  }

  async refreshActivity(): Promise<ActivityEntry[]> {
    const logs = await this.aegis.getActionLog();
    const onChain = logs.map((entry, index): ActivityEntry => {
      const isSpl = entry.kind === ActionKind.TransferSpl;
      const tokenAsset = isSpl ? this.tokenForMint(entry.mint) : undefined;
      return {
        id: `chain-${entry.sig ?? entry.ts}-${index}`,
        // Both native and SPL transfers render as a transfer row; the asset
        // distinguishes them, and the on-chain record carries historical mint.
        kind: "transfer",
        label: this.addressBook.labelFor(entry.target),
        asset: isSpl ? tokenAsset?.symbol ?? "TOKEN" : "SOL",
        amount: entry.amount,
        decimals: isSpl ? tokenAsset?.decimals ?? SOL_DECIMALS : SOL_DECIMALS,
        result: entry.result,
        reason: entry.reason,
        reasonCode: entry.reasonCode,
        ts: entry.ts,
        sig: entry.sig,
      };
    });
    const keyed = new Map<string, ActivityEntry>();
    for (const entry of [...this.state.activity, ...onChain]) {
      keyed.set(entry.sig ?? entry.id, entry);
    }
    this.state.activity = [...keyed.values()].sort((a, b) => b.ts - a.ts);
    return this.state.activity;
  }

  async refreshOnChain(): Promise<void> {
    await this.refreshPolicy();
    await this.refreshActivity();
    await this.commit();
  }

  // --- reads ---
  getThreads = (): Thread[] => [...this.state.threads].sort((a, b) => b.updatedAt - a.updatedAt);
  getThread = (id: string): Thread | undefined => this.state.threads.find((thread) => thread.id === id);
  getProposal = (id: string): ActionProposal | undefined => this.state.proposals[id];
  getPolicy = (): PolicyView => {
    if (!this.state.policy) throw new PraxisNotFoundError("Policy has not been loaded yet.");
    return this.state.policy;
  };
  getActivity = (): ActivityEntry[] => [...this.state.activity].sort((a, b) => b.ts - a.ts);
  getAddressBook = (): AddressBookEntry[] => this.addressBook.all();
  isThinking = (threadId: string): boolean => Boolean(this.state.thinking[threadId]);
  getConnectionState = () => ({ mode: "api" as const, phase: "ready" as const });
  getVersion = (): number => this.version;

  // --- conversation ---
  newThread = (preferredId?: string): string => {
    const id = preferredId ?? this.id("t");
    if (this.getThread(id)) return id;
    this.state.threads = [{ id, title: "New session", messages: [], updatedAt: nowSeconds() }, ...this.state.threads];
    this.commitInBackground();
    return id;
  };

  send = async (threadId: string | null, text: string): Promise<{ threadId: string }> => {
    const tid = threadId ?? this.newThread();
    const thread = this.requireThread(tid);
    const ts = nowSeconds();

    thread.messages = [...thread.messages, { id: this.id("m"), role: "user", ts, text }];
    thread.updatedAt = ts;
    this.state.thinking = { ...this.state.thinking, [tid]: true };
    this.commitInBackground();

    let blocks: AgentBlock[];
    let title: string | undefined;
    try {
      const intent = await this.parseIntent(text);
      const result = await this.blocksForIntent(intent);
      blocks = result.blocks;
      title = result.title;
    } catch (error) {
      blocks = [
        {
          type: "prose",
          text: error instanceof Error ? error.message : "The agent could not parse that request.",
        },
      ];
    }

    const reply: Message = { id: this.id("m"), role: "agent", ts: nowSeconds(), blocks };
    thread.messages = [...thread.messages, reply];
    if (title && (thread.title === "New session" || thread.messages.length <= 2)) thread.title = title;
    thread.updatedAt = reply.ts;
    this.state.thinking = { ...this.state.thinking, [tid]: false };
    await this.commit();
    return { threadId: tid };
  };

  signProposal = async (proposalId: string): Promise<void> => {
    const proposal = this.state.proposals[proposalId];
    if (!proposal) throw new PraxisNotFoundError(`unknown proposal ${proposalId}`);
    if (proposal.state !== "pending") return;

    proposal.state = "signing";
    this.commitInBackground();

    if (proposal.detail.kind === "swap") {
      proposal.state = "blocked";
      proposal.simulation = "agent_swap is a typed stub; Jupiter CPI is not implemented.";
      this.logSwapRejection(proposal);
      await this.commit();
      return;
    }

    const recipient = new PublicKey(proposal.detail.recipientAddress);
    const asset = proposal.detail.asset;
    const isSol = asset.symbol === "SOL";
    const execution = isSol
      ? await this.aegis.executeAgentTransfer(recipient, proposal.detail.amount)
      : await this.aegis.executeAgentTransferSpl(recipient, asset, proposal.detail.amount);
    proposal.check = execution.check;
    proposal.sig = execution.sig;
    proposal.state = execution.status === "confirmed" ? "signed" : "blocked";
    proposal.simulation = execution.status === "confirmed"
      ? `Confirmed through Aegis ${isSol ? "agent_transfer" : "agent_transfer_spl"}`
      : "Rejected by Aegis during execution";

    this.state.activity = [
      {
        id: this.id("a"),
        kind: "transfer",
        label: proposal.detail.recipientName,
        asset: asset.symbol,
        amount: proposal.detail.amount,
        decimals: asset.decimals,
        result: execution.status === "confirmed" ? "allowed" : "rejected",
        reason: execution.check.reason,
        reasonCode: execution.check.reasonCode,
        ts: nowSeconds(),
        sig: execution.sig,
      },
      ...this.state.activity,
    ];

    await this.refreshPolicy().catch(() => undefined);
    await this.commit();
  };

  cancelProposal = async (proposalId: string): Promise<void> => {
    const proposal = this.state.proposals[proposalId];
    if (!proposal) return;
    proposal.state = "cancelled";
    await this.commit();
  };

  // --- policy dashboard ---
  bootstrapPolicy = async (fundLamports?: bigint): Promise<void> => {
    this.assertBackendOwnerSigningAvailable();
    await this.aegis.bootstrapPolicy(fundLamports);
    await this.refreshOnChain();
  };

  fundVault = async (amount: bigint): Promise<void> => {
    this.assertBackendOwnerSigningAvailable();
    await this.aegis.fundVault(amount);
    await this.refreshOnChain();
  };

  withdrawVault = async (amount: bigint): Promise<void> => {
    this.assertBackendOwnerSigningAvailable();
    await this.aegis.withdrawVault(amount);
    await this.refreshOnChain();
  };

  deleteAgent = async (): Promise<void> => {
    this.assertBackendOwnerSigningAvailable();
    await this.aegis.closePolicy();
    // The policy account is gone now; drop the cached view so reads 404 and the
    // app returns to onboarding rather than serving a stale policy.
    this.state.policy = undefined;
    await this.commit();
  };

  updatePolicy = async (patch: PolicyUpdate): Promise<void> => {
    this.assertBackendOwnerSigningAvailable();
    await this.aegis.updatePolicy(patch);
    await this.refreshOnChain();
  };

  configureToken = async (config: TokenEnvelopeConfig): Promise<void> => {
    this.assertBackendOwnerSigningAvailable();
    validatePublicKey(config.tokenMint);
    await this.aegis.configureToken({
      tokenMint: config.tokenMint,
      tokenMaxPerTx: config.tokenMaxPerTx,
      tokenDailyLimit: config.tokenDailyLimit,
    });
    await this.aegis.ensureSplTokenAccounts(config.tokenMint);
    await this.refreshOnChain();
  };

  prepareTokenAccounts = async (recipientAddresses: string[] = []): Promise<void> => {
    this.assertBackendOwnerSigningAvailable();
    const recipients = recipientAddresses.map((address) => validatePublicKey(address));
    await this.aegis.ensureConfiguredTokenAccounts(recipients);
    await this.commit();
  };

  revokeAgent = async (): Promise<void> => {
    this.assertBackendOwnerSigningAvailable();
    await this.aegis.revokeAgent();
    await this.refreshOnChain();
  };

  rotateAgent = async (): Promise<void> => {
    this.assertBackendOwnerSigningAvailable();
    await this.aegis.rotateAgent();
    await this.refreshOnChain();
  };

  /**
   * Build an UNSIGNED owner-action transaction for the signed-in wallet to sign.
   * This is the production custody path: the backend never holds the owner key;
   * the owner's wallet is the sole signer. The on-chain `has_one = owner`
   * constraint binds the transaction to this session's wallet PDA.
   */
  buildOwnerAction = async (action: OwnerAction): Promise<UnsignedOwnerTransaction> => {
    return this.aegis.buildUnsignedOwnerTransaction(this.requireOwnerWallet(), action);
  };

  /** Submit a wallet-signed owner transaction, then refresh on-chain state. */
  submitOwnerAction = async (input: UnsignedOwnerTransaction): Promise<{ signature: string }> => {
    const owner = this.requireOwnerWallet();
    const signature = await this.aegis.submitSignedTransaction(input, { expectedFeePayer: owner });
    try {
      await this.refreshOnChain();
    } catch (error) {
      // A closePolicy (delete agent) teardown removes the policy account, so the
      // post-submit refresh 404s. That's success — clear the cached policy so
      // subsequent reads 404 and the app returns to onboarding.
      if (error instanceof PraxisNotFoundError) {
        this.state.policy = undefined;
        await this.commit();
      } else {
        throw error;
      }
    }
    return { signature };
  };

  addToAllowList = async (kind: AllowListKind, address: string): Promise<void> => {
    this.assertBackendOwnerSigningAvailable();
    validatePublicKey(address);
    await this.aegis.updateAllowList(kind, address, "add");
    await this.refreshOnChain();
  };

  removeFromAllowList = async (kind: AllowListKind, address: string): Promise<void> => {
    this.assertBackendOwnerSigningAvailable();
    validatePublicKey(address);
    await this.aegis.updateAllowList(kind, address, "remove");
    await this.refreshOnChain();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private async parseIntent(text: string): Promise<ParsedIntent> {
    // Prefer the real LLM so free-form phrasing ("solana price now") is actually
    // understood. The deterministic parser is only a fallback: when explicitly
    // forced, when no Gemini key is configured, or when a Gemini call fails
    // (rate limit / network) so a transient hiccup still does something useful.
    const forceLocal = process.env.PRAXIS_LOCAL_INTENT === "1";
    if (forceLocal || !this.config.geminiApiKey) {
      return parseIntentLocallyForDemo(text);
    }
    try {
      return await parseIntentWithGemini(text, this.config);
    } catch (error) {
      logger.warn("intent.gemini_failed_fallback_local", errorFields(error));
      return parseIntentLocallyForDemo(text);
    }
  }

  private async blocksForIntent(intent: ParsedIntent): Promise<{ blocks: AgentBlock[]; title?: string }> {
    if (intent.outcome === "clarify") {
      return {
        blocks: [
          {
            type: "clarify",
            text: intent.question,
            options: (intent.options ?? []).map((option) => ({ label: option, value: option })),
          },
        ],
      };
    }

    if (intent.outcome === "unsupported") {
      return { blocks: [{ type: "prose", text: intent.message }] };
    }

    const blocks: AgentBlock[] = [];
    let title: string | undefined;
    for (const action of intent.actions) {
      const result = await this.blockForAction(action);
      blocks.push(...result.blocks);
      title ??= result.title;
    }
    return { blocks, title };
  }

  private async blockForAction(action: ParsedAction): Promise<{ blocks: AgentBlock[]; title?: string }> {
    if (action.kind === "transfer") return this.transferBlock(action);
    if (action.kind === "research") return this.researchBlock(action.token);
    return this.swapStubBlock(action);
  }

  private async transferBlock(action: Extract<ParsedAction, { kind: "transfer" }>): Promise<{ blocks: AgentBlock[]; title?: string }> {
    const resolved = this.addressBook.resolve(action.recipient);
    if (resolved.kind !== "exact") {
      return {
        blocks: [
          {
            type: "clarify",
            text: resolved.question,
            options: resolved.options,
          },
        ],
      };
    }

    // Native SOL routes through agent_transfer; an SPL token through the
    // dedicated token envelope (agent_transfer_spl). The asset's own decimals
    // drive amount parsing and display.
    const token = this.token(action.asset);
    const isSol = token.symbol === "SOL";
    const amount = parseHumanUnits(action.amountHuman, token.decimals);
    const recipient = new PublicKey(resolved.entry.address);
    const preview = isSol
      ? await this.aegis.simulateAgentTransfer(recipient, amount)
      : await this.aegis.simulateAgentTransferSpl(recipient, token, amount);

    const proposal: ActionProposal = {
      id: this.id("p"),
      detail: {
        kind: "transfer",
        amount,
        asset: token,
        recipientName: resolved.entry.name,
        recipientAddress: resolved.entry.address,
        recipientNote: resolved.entry.note,
      },
      networkFee: preview.networkFee,
      simulation: preview.simulation,
      check: preview.check,
      state: preview.check.allowed ? "pending" : "blocked",
    };
    this.state.proposals[proposal.id] = proposal;

    if (!preview.check.allowed) {
      this.state.activity = [
        {
          id: this.id("a"),
          kind: "transfer",
          label: resolved.entry.name,
          asset: token.symbol,
          amount,
          decimals: token.decimals,
          result: "rejected",
          reason: preview.check.reason,
          reasonCode: preview.check.reasonCode,
          ts: nowSeconds(),
        },
        ...this.state.activity,
      ];
    }

    return {
      blocks: [
        {
          type: "proposal",
          text: `Resolved ${resolved.entry.name} from the address book.`,
          proposalId: proposal.id,
        },
      ],
      title: `Send to ${resolved.entry.name.split(" ")[0]}`,
    };
  }

  private async researchBlock(token: string): Promise<{ blocks: AgentBlock[]; title?: string }> {
    const data = await researchToken(token, getResearchConnection(this.config), this.config);
    return {
      blocks: [
        {
          type: "research",
          text: `Read-only on-chain and market data for ${data.token}. No buy, sell, or hold advice.`,
          data,
        },
      ],
      title: `${data.token} research`,
    };
  }

  private async swapStubBlock(action: Extract<ParsedAction, { kind: "swap_stub" }>): Promise<{ blocks: AgentBlock[]; title?: string }> {
    const assetIn = this.token(action.assetIn);
    const assetOut = this.token(action.assetOut);
    const amountIn = parseHumanUnits(action.amountHuman, assetIn.decimals);

    // Run the SAME allow-list check the mock runs, so demo §9 #3 ("the allow-list
    // holds") is faithful in API mode. This is an agent-layer (pre-CPI) verdict:
    // the on-chain agent_swap is v2, so a rejection here is the honest gate, not
    // an on-chain RejectReason. Falls back to a plain stub if the policy can't be
    // loaded (half-configured API mode).
    const policy = await this.ensurePolicy();
    const check = policy
      ? checkSwapPolicy(policy, assetOut, JUPITER_PROGRAM_ID.toBase58(), nowSeconds())
      : undefined;

    // A swap can never EXECUTE today (no Jupiter CPI), so the proposal is always
    // blocked. The REASON is what we make faithful: an allow-list rejection when
    // the policy forbids the route, else an honest "v2 not built" note.
    const blockedReason = !check
      ? "agent_swap is a typed stub for v2. No Jupiter CPI is constructed or signed."
      : check.allowed
        ? "Your Aegis policy would allow this route, but agent_swap (the on-chain Jupiter CPI) is a v2 instruction and isn't built yet — Praxis won't sign a swap it can't enforce on-chain."
        : check.reason;

    const proposal: ActionProposal = {
      id: this.id("p"),
      detail: {
        kind: "swap",
        amountIn,
        assetIn,
        estAmountOut: 0n,
        assetOut,
        route: "agent_swap stub",
        priceImpactBps: 0,
      },
      networkFee: 0n,
      simulation: check && !check.allowed
        ? `Would be rejected by policy: ${check.reason}`
        : "agent_swap is intentionally out of scope; Jupiter CPI is not built.",
      check: {
        allowed: false,
        reason: blockedReason,
        spentToday: check?.spentToday ?? policy?.spentToday ?? 0n,
        dailyLimit: check?.dailyLimit ?? policy?.dailyLimit ?? 0n,
        remaining: check?.remaining ?? 0n,
      },
      state: "blocked",
    };
    this.state.proposals[proposal.id] = proposal;
    this.logSwapRejection(proposal);

    const blocked = Boolean(check && !check.allowed);
    return {
      blocks: [
        {
          type: "proposal",
          text: blocked
            ? "I found a route, but your Aegis policy blocks it."
            : "Swap intent parsed, but agent_swap is a typed stub until the Jupiter CPI is implemented.",
          proposalId: proposal.id,
        },
      ],
      title: `${assetIn.symbol} swap stub`,
    };
  }

  /** Return the cached policy, loading it once if needed; undefined if unloadable. */
  private async ensurePolicy(): Promise<PolicyView | undefined> {
    if (this.state.policy) return this.state.policy;
    try {
      return await this.refreshPolicy();
    } catch {
      return undefined;
    }
  }

  private logSwapRejection(proposal: ActionProposal) {
    if (proposal.detail.kind !== "swap") return;
    this.state.activity = [
      {
        id: this.id("a"),
        kind: "swap",
        label: `${proposal.detail.assetIn.symbol} -> ${proposal.detail.assetOut.symbol}`,
        asset: proposal.detail.assetIn.symbol,
        amount: proposal.detail.amountIn,
        decimals: proposal.detail.assetIn.decimals,
        result: "rejected",
        reason: proposal.check.reason,
        ts: nowSeconds(),
      },
      ...this.state.activity,
    ];
  }

  private requireThread(id: string): Thread {
    const thread = this.getThread(id);
    if (!thread) throw new PraxisNotFoundError(`unknown thread ${id}`);
    return thread;
  }

  /** Resolve the policy's configured token mint to a known TokenInfo. */
  private tokenForMint(mint: string | undefined): TokenInfo | undefined {
    if (!mint) return undefined;
    return this.config.tokens.find((item) => item.mint === mint);
  }

  private token(symbol: string): TokenInfo {
    const normalized = symbol.trim().replace(/^\$/, "").toUpperCase();
    const token = this.config.tokens.find((item) => item.symbol.toUpperCase() === normalized);
    if (token) return token;
    return {
      symbol: normalized,
      mint: SYSTEM_PROGRAM,
      decimals: SOL_DECIMALS,
      verified: false,
    };
  }

  private id(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private requireOwnerWallet(): PublicKey {
    if (!this.config.ownerAddress) {
      throw new PraxisConfigError("No owner wallet is associated with this session.");
    }
    return this.config.ownerAddress;
  }

  private assertBackendOwnerSigningAvailable() {
    if (
      this.config.ownerAddress
      && this.config.ownerKeypair
      && this.config.ownerKeypair.publicKey.equals(this.config.ownerAddress)
    ) {
      return;
    }
    throw new PraxisConfigError(
      "This owner action needs wallet-signed transactions. The current API can only submit owner transactions when PRAXIS_OWNER_KEYPAIR matches the signed-in wallet.",
    );
  }

  private notify() {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  private async commit(): Promise<void> {
    this.notify();
    await this.persist();
  }

  private commitInBackground() {
    this.notify();
    void this.persist().catch((error) => {
      logger.warn("praxis.state_persist_failed", errorFields(error));
    });
  }

  async flushPersistence(): Promise<void> {
    await this.persist();
  }

  private async persist(): Promise<void> {
    const state: StoredProviderState = {
      threads: this.state.threads,
      proposals: this.state.proposals,
      activity: this.state.activity,
    };
    await this.repository.save(this.ownerKey, state);
  }
}

function welcomeThread(ts: number): Thread {
  return {
    id: "t-welcome",
    title: "New session",
    updatedAt: ts,
    messages: [
      {
        id: "m-welcome",
        role: "agent",
        ts,
        blocks: [
          {
            type: "prose",
            text:
              "Praxis is connected to the Aegis policy engine. Ask for a SOL send, token research, or a swap preview.",
          },
        ],
      },
    ],
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
