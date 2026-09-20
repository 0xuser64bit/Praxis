import { PublicKey } from "@solana/web3.js";
import {
  ActionKind,
  type ActionProposal,
  type ActivityEntry,
  type AddressBookEntry,
  type AgentBlock,
  type AllowListKind,
  type ClarifyOption,
  type Message,
  type PolicyChangeRow,
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
  type TransferSimulation,
  type UnsignedOwnerTransaction,
} from "../aegis/client";
import { JUPITER_PROGRAM_ID } from "../aegis/constants";
import { AddressBook } from "../agent/addressBook";
import { checkSwapPolicy } from "../agent/policy";
import { explainPolicy } from "../agent/policyExplainer";
import {
  parseIntentLocallyForDemo,
  parseIntentWithGemini,
  type ParsedAction,
  type ParsedIntent,
} from "../agent/intent";
import { researchToken } from "../agent/research";
import { getResearchConnection } from "../aegis/client";
import {
  assertSharedAgentKeySafe,
  configForWalletOwner,
  getServerConfig,
  validatePublicKey,
  type PraxisServerConfig,
} from "../env";
import {
  PraxisConflictError,
  PraxisConfigError,
  PraxisInputError,
  PraxisNotFoundError,
} from "../errors";
import { formatSol, formatUnits, parseHumanUnits, SOL_DECIMALS } from "../units";
import { getStateRepository, type LoadedState, type StateRepository } from "./stateRepository";
import type { StoredProviderState } from "./stateSerialization";
import {
  advanceCadence,
  availableBaskets,
  describeCadence,
  resolveBasket,
  sameCadence,
  splitBasket,
  type DcaSchedule,
} from "../stocks/schedules";
import { fetchPrestocksEntries, findPrestocksEntry } from "../stocks/prestocks";
import { resolveMintDecimals } from "../stocks/mintDecimals";
import { hasProvisionalDecimals } from "../stocks/universe";
import { errorFields, logger } from "../observability/logger";

interface StoreState {
  threads: Thread[];
  proposals: Record<string, ActionProposal>;
  activity: ActivityEntry[];
  contacts: AddressBookEntry[];
  /** Stocklana C06: mechanical DCA schedules (persisted; cron fires emit proposals). */
  schedules: DcaSchedule[];
  /** Tombstoned contact addresses/labels (lowercased) — see StoredProviderState. */
  removedContacts: string[];
  policy?: PolicyView;
  /** threadId -> ms timestamp when thinking started (TTL-guarded, never persisted). */
  thinking: Record<string, number>;
}

const THINKING_TTL_MS = 5 * 60 * 1000;

/** Bounded retries when claiming a proposal against a concurrent writer. */
const CLAIM_ATTEMPTS = 3;

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

let singleton: PraxisServerProvider | undefined;

function ownerKeyForConfig(config: PraxisServerConfig): string {
  return config.ownerAddress?.toBase58() ?? config.policyAddress?.toBase58() ?? "default";
}

/**
 * Per-wallet async mutex (single-instance). The provider is reconstructed per
 * request from the repository, so two concurrent `send`/`signProposal` calls
 * for the same wallet would otherwise load → mutate → save on stale snapshots
 * and drop messages or double-execute a proposal. Serializing mutating calls
 * per ownerKey fixes the single-instance race; cross-instance races still rely
 * on single-writer affinity (documented in ARCHITECTURE.md).
 */
const ownerLocks = new Map<string, Promise<void>>();

async function withOwnerLock<T>(ownerKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = ownerLocks.get(ownerKey) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = prev.then(() => current);
  ownerLocks.set(ownerKey, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    // Drop the tail once settled if no waiter chained after us.
    void tail.then(() => {
      if (ownerLocks.get(ownerKey) === tail) ownerLocks.delete(ownerKey);
    });
  }
}

export function resetOwnerLocksForTests() {
  ownerLocks.clear();
}

/**
 * Build a provider for a wallet, loading its durable state from the configured
 * {@link StateRepository} on every call. Async because a managed-database backend
 * loads over the network.
 *
 * The provider is intentionally NOT cached across requests. On serverless
 * (multiple Fluid Compute instances), a cached in-memory provider serves stale
 * state and never observes writes made by another instance — the symptom is an
 * "unknown thread" error when a thread created on instance A is sent to on
 * instance B. The repository is the single source of truth; each request gets a
 * fresh, isolated view of it (which also avoids shared mutable state between
 * concurrent requests on the same instance).
 */
export async function getPraxisServerProvider(walletAddress?: string): Promise<PraxisServerProvider> {
  const repository = getStateRepository();

  if (walletAddress) {
    const normalized = validatePublicKey(walletAddress, "walletAddress").toBase58();
    // Fail closed before doing any work if a shared agent key would span owners
    // in production without an explicit acknowledgement.
    assertSharedAgentKeySafe(normalized);
    const config = configForWalletOwner(new PublicKey(normalized));
    const loaded = await repository.load(ownerKeyForConfig(config));
    return new PraxisServerProvider(config, new AegisClient(config), loaded);
  }

  if (!singleton) {
    const config = getServerConfig();
    const loaded = await repository.load(ownerKeyForConfig(config));
    singleton = new PraxisServerProvider(config, new AegisClient(config), loaded);
  }
  return singleton;
}

export function resetPraxisServerProviderForTests() {
  singleton = undefined;
}

export class PraxisServerProvider implements PraxisProvider {
  private readonly config: PraxisServerConfig;
  private readonly aegis: AegisClient;
  private readonly addressBook: AddressBook;
  private readonly ownerKey: string;
  private readonly repository: StateRepository;
  private readonly listeners = new Set<() => void>();
  private state: StoreState;
  /** Revision this provider's snapshot was loaded at; advanced by each save. */
  private rev: number;
  /** Tail of this provider's serialized write chain (see {@link enqueueWrite}). */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    config = getServerConfig(),
    aegis = new AegisClient(config),
    loaded?: LoadedState,
  ) {
    this.config = config;
    this.aegis = aegis;
    this.repository = getStateRepository();
    this.rev = loaded?.rev ?? 0;
    const initialState = loaded?.state;
    const savedContacts = initialState?.contacts ?? [];
    // Tombstoned entries stay removed even when they come from the env-seeded
    // config book (which is re-merged on every fresh construction).
    const removed = new Set((initialState?.removedContacts ?? []).map((key) => key.toLowerCase()));
    const visible = (entry: AddressBookEntry) =>
      !removed.has(entry.address.toLowerCase()) && !removed.has(entry.label.toLowerCase());
    this.addressBook = new AddressBook(
      [...savedContacts, ...config.addressBook].filter(visible),
    );
    this.ownerKey = ownerKeyForConfig(config);
    this.state = {
      threads: initialState?.threads.length ? initialState.threads : [welcomeThread(nowSeconds())],
      proposals: initialState?.proposals ?? {},
      activity: initialState?.activity ?? [],
      contacts: savedContacts,
      schedules: initialState?.schedules ?? [],
      removedContacts: [...removed],
      thinking: {},
    };
  }

  /**
   * Price source seam for basket splits (production: PreStocks tokenPrice).
   * A public field so tests can stub it without network access.
   */
  basketPriceSource = async (symbols: string[]): Promise<Map<string, number>> => {
    const entries = await fetchPrestocksEntries(this.config.prestocksApiUrl, this.config.prestocksTimeoutMs);
    const out = new Map<string, number>();
    for (const symbol of symbols) {
      const entry = findPrestocksEntry(entries, symbol);
      if (entry) out.set(symbol, entry.tokenPrice);
    }
    return out;
  };

  /** Durable DCA schedules for this wallet (read path for the cron route). */
  getSchedules = (): DcaSchedule[] => [...this.state.schedules];

  /**
   * Fire every due DCA schedule: each emits ONE transfer proposal through the
   * same simulate + policy-check path as a one-off buy. Never signs — every
   * fire needs a user signature. Advances each schedule past `nowMs` (with a
   * capped catch-up so a long-dead schedule fires once, not 500 times).
   */
  fireDueSchedules = async (
    nowMs: number = Date.now(),
  ): Promise<Array<{ scheduleId: string; proposalId: string; allowed: boolean }>> => {
    return withOwnerLock(this.ownerKey, async () => {
      const fired: Array<{ scheduleId: string; proposalId: string; allowed: boolean }> = [];
      for (const schedule of this.state.schedules) {
        if (schedule.nextFireTs > nowMs) continue;
        const token = this.token(schedule.asset);
        const preview = await this.previewTransfer(token, schedule.amount, schedule.recipientAddress);
        const proposal = this.storeTransferProposal({
          token,
          amount: schedule.amount,
          recipientName: schedule.recipientName,
          recipientAddress: schedule.recipientAddress,
          preview,
        });
        const thread = this.getThread(schedule.threadId);
        if (thread) {
          const ts = nowSeconds();
          thread.messages = [
            ...thread.messages,
            {
              id: this.id("m"),
              role: "agent",
              ts,
              blocks: [{
                type: "proposal",
                text: `Scheduled buy fired (${describeCadence(schedule.cadence)}): ${schedule.asset} for ${schedule.recipientName}.`,
                proposalId: proposal.id,
              }],
            },
          ];
          thread.updatedAt = ts;
        }
        let next = schedule.nextFireTs;
        let hops = 0;
        while (next <= nowMs && hops < 1000) {
          next = advanceCadence(schedule.cadence, next);
          hops++;
        }
        schedule.nextFireTs = hops >= 1000 ? advanceCadence(schedule.cadence, nowMs) : next;
        fired.push({ scheduleId: schedule.id, proposalId: proposal.id, allowed: preview.check.allowed });
      }
      if (fired.length > 0) await this.commit();
      return fired;
    });
  };

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
  getAllProposals = (): ActionProposal[] => Object.values(this.state.proposals);
  getPolicy = (): PolicyView => {
    if (!this.state.policy) throw new PraxisNotFoundError("Policy has not been loaded yet.");
    return this.state.policy;
  };
  getActivity = (): ActivityEntry[] => [...this.state.activity].sort((a, b) => b.ts - a.ts);
  getAddressBook = (): AddressBookEntry[] => this.addressBook.all();
  isThinking = (threadId: string): boolean => {
    const startedAt = this.state.thinking[threadId];
    if (!startedAt) return false;
    // A crash between thinking=true and thinking=false would otherwise leave a
    // stale `true` until the next send completes; expire it after the TTL.
    if (Date.now() - startedAt > THINKING_TTL_MS) return false;
    return true;
  };
  getConnectionState = () => ({ mode: "api" as const, phase: "ready" as const });
  /**
   * A durable state cursor derived from persisted state (stable across
   * serverless instances). Base is the newest mutation timestamp (unix
   * seconds); the low digits fold in message/proposal counts so two mutations
   * within the same second still advance the cursor for polling clients.
   */
  getVersion = (): number => {
    let cursor = 0;
    let messages = 0;
    for (const thread of this.state.threads) {
      cursor = Math.max(cursor, thread.updatedAt);
      messages += thread.messages.length;
    }
    for (const entry of this.state.activity) cursor = Math.max(cursor, entry.ts);
    const proposals = Object.keys(this.state.proposals).length;
    return cursor * 10_000 + (messages % 1_000) * 10 + (proposals % 10);
  };

  // --- conversation ---
  newThread = (preferredId?: string): string => {
    const id = preferredId ?? this.id("t");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new PraxisNotFoundError("Invalid thread id.");
    }
    if (this.getThread(id)) return id;
    this.state.threads = [{ id, title: "New session", messages: [], updatedAt: nowSeconds() }, ...this.state.threads];
    this.commitInBackground();
    return id;
  };

  send = async (threadId: string | null, text: string): Promise<{ threadId: string }> => {
    return withOwnerLock(this.ownerKey, async () => {
      // `newThread` is idempotent: it returns the id if the thread already exists,
      // and creates it otherwise. Passing the caller's id through it (rather than
      // requiring the thread to pre-exist) means a thread created in a prior
      // request — possibly persisted by a different serverless instance — is never
      // rejected as "unknown" here; at worst we re-materialize an empty thread.
      const tid = this.newThread(threadId ?? undefined);
      const thread = this.requireThread(tid);
      const ts = nowSeconds();

      thread.messages = [...thread.messages, { id: this.id("m"), role: "user", ts, text }];
      thread.updatedAt = ts;
      this.state.thinking = { ...this.state.thinking, [tid]: Date.now() };
      await this.commit();

      let blocks: AgentBlock[];
      let title: string | undefined;
      try {
        const intent = await this.parseIntent(text);
        const result = await this.blocksForIntent(intent, tid);
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
      delete this.state.thinking[tid];
      await this.commit();
      return { threadId: tid };
    });
  };

  signProposal = async (proposalId: string): Promise<void> => {
    return withOwnerLock(this.ownerKey, async () => {
      // Claim before executing. The claim is compare-and-swapped onto the
      // stored document, so exactly one writer — across instances, not just
      // within this process — proceeds to submit the transfer.
      const proposal = await this.claimProposalForExecution(proposalId);
      if (!proposal) return;

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
    });
  };

  cancelProposal = async (proposalId: string): Promise<void> => {
    return withOwnerLock(this.ownerKey, async () => {
      const proposal = this.state.proposals[proposalId];
      if (!proposal) return;
      if (proposal.state !== "pending") return;
      proposal.state = "cancelled";
      await this.commit();
    });
  };

  /**
   * Stop a recurring-buy schedule. Idempotent: an unknown id is a no-op so a
   * retried tap (or a schedule that just fired) never errors.
   */
  cancelSchedule = async (scheduleId: string): Promise<void> => {
    return withOwnerLock(this.ownerKey, async () => {
      const before = this.state.schedules.length;
      this.state.schedules = this.state.schedules.filter((s) => s.id !== scheduleId);
      if (this.state.schedules.length !== before) await this.commit();
    });
  };

  /**
   * Save (or rename) a contact. Upserts by address and label, clears any
   * removal tombstone for it, and persists — the same book the chat
   * `save_contact` path writes to.
   */
  addContact = async (label: string, address: string): Promise<void> => {
    return withOwnerLock(this.ownerKey, async () => {
      const cleanLabel = label.trim().replace(/[.?!]+$/, "");
      if (!cleanLabel) throw new PraxisInputError("label must be a non-empty string");
      let normalized: string;
      try {
        normalized = new PublicKey(address.trim()).toBase58();
      } catch {
        throw new PraxisInputError("address must be a valid Solana public key");
      }
      const entry: AddressBookEntry = {
        label: cleanLabel.toLowerCase(),
        name: cleanLabel,
        address: normalized,
      };
      this.addressBook.add(entry);
      this.state.contacts = [
        entry,
        ...this.state.contacts.filter((c) => c.address !== entry.address && c.label !== entry.label),
      ];
      const untombstone = new Set([entry.address.toLowerCase(), entry.label.toLowerCase()]);
      this.state.removedContacts = this.state.removedContacts.filter((key) => !untombstone.has(key));
      await this.commit();
    });
  };

  /**
   * Remove a contact by address or label (case-insensitive). Idempotent:
   * unknown keys are a no-op. Env-seeded contacts are tombstoned so the
   * removal survives the next fresh construction.
   */
  removeContact = async (key: string): Promise<void> => {
    return withOwnerLock(this.ownerKey, async () => {
      const removed = this.addressBook.remove(key);
      if (removed.length === 0) return;
      const gone = new Set<string>();
      for (const entry of removed) {
        gone.add(entry.address);
        gone.add(entry.label);
      }
      this.state.contacts = this.state.contacts.filter((c) => !gone.has(c.address) && !gone.has(c.label));
      const tombstoned = new Set(this.state.removedContacts);
      for (const entry of removed) {
        tombstoned.add(entry.address.toLowerCase());
        tombstoned.add(entry.label.toLowerCase());
      }
      this.state.removedContacts = [...tombstoned];
      await this.commit();
    });
  };

  // --- policy dashboard ---
  bootstrapPolicy = async (fundLamports?: bigint): Promise<void> => {
    this.assertBackendOwnerSigningAvailable();
    await this.aegis.bootstrapPolicy(fundLamports);
    await this.refreshOnChain();
  };

  fundVault = async (amount: bigint): Promise<void> => {
    this.assertBackendOwnerSigningAvailable();
    if (amount <= 0n) throw new PraxisInputError("amount must be greater than zero");
    await this.aegis.fundVault(amount);
    await this.refreshOnChain();
  };

  withdrawVault = async (amount: bigint): Promise<void> => {
    this.assertBackendOwnerSigningAvailable();
    if (amount <= 0n) throw new PraxisInputError("amount must be greater than zero");
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
    if (config.tokenMaxPerTx <= 0n || config.tokenDailyLimit <= 0n) {
      throw new PraxisInputError("token caps must be greater than zero");
    }
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
  submitOwnerAction = async (input: UnsignedOwnerTransaction): Promise<{ sig: string }> => {
    const owner = this.requireOwnerWallet();
    const sig = await this.aegis.submitSignedTransaction(input, { expectedFeePayer: owner });
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
    return { sig };
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

  private async blocksForIntent(
    intent: ParsedIntent,
    threadId?: string,
  ): Promise<{ blocks: AgentBlock[]; title?: string }> {
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
    // Process save_contact first so a sibling transfer can resolve the freshly
    // saved label to a friendly name on its proposal card.
    const ordered = [...intent.actions].sort(
      (a, b) => (a.kind === "save_contact" ? -1 : 0) - (b.kind === "save_contact" ? -1 : 0),
    );
    for (const action of ordered) {
      const result = await this.blockForAction(action, threadId);
      blocks.push(...result.blocks);
      title ??= result.title;
    }
    return { blocks, title };
  }

  private async blockForAction(
    action: ParsedAction,
    threadId?: string,
  ): Promise<{ blocks: AgentBlock[]; title?: string }> {
    if (action.kind === "transfer") return this.transferBlock(action);
    if (action.kind === "research") return this.researchBlock(action.token);
    if (action.kind === "policy_question") return this.policyQuestionBlock(action.topic);
    if (action.kind === "save_contact") return this.saveContactBlock(action.label, action.address);
    if (action.kind === "policy_change") return this.policyChangeBlock(action);
    if (action.kind === "schedule_dca") return this.scheduleDcaBlock(action, threadId);
    if (action.kind === "basket_buy") return this.basketBlock(action);
    return this.swapStubBlock(action);
  }

  private async policyQuestionBlock(
    topic: "caps" | "expiry" | "allowlist" | "pause" | "general",
  ): Promise<{ blocks: AgentBlock[]; title?: string }> {
    const policy = await this.ensurePolicy();
    if (!policy) {
      return {
        blocks: [{
          type: "prose",
          text: "I can't read your policy right now. Make sure your wallet is connected and your policy is initialized.",
        }],
      };
    }
    return { blocks: explainPolicy(policy, nowSeconds(), topic), title: "Your policy" };
  }

  private async policyChangeBlock(
    action: Extract<ParsedAction, { kind: "policy_change" }>,
  ): Promise<{ blocks: AgentBlock[]; title?: string }> {
    const policy = await this.ensurePolicy();
    if (!policy) {
      return {
        blocks: [{
          type: "prose",
          text: "I can't read your policy right now, so I can't change it. Make sure your wallet is connected and your policy is initialized.",
        }],
      };
    }

    const built = this.buildPolicyPatch(policy, action);
    if ("error" in built) {
      return { blocks: [{ type: "clarify", text: built.error, options: [] }] };
    }
    const { patch, changes } = built;

    // Honor the "apply immediately" choice when the backend can actually sign an
    // owner transaction (a backend owner key is configured). Under wallet custody
    // (the default here) the server can't summon the wallet, so we hand the
    // change to the client as a one-tap, wallet-signed action instead.
    if (this.backendOwnerSigningAvailable()) {
      try {
        await this.updatePolicy(patch);
        return {
          blocks: [{
            type: "policy_change",
            text: "Done — your policy is updated and enforced on-chain.",
            patch,
            changes,
            applied: true,
          }],
          title: "Policy updated",
        };
      } catch (error) {
        return {
          blocks: [{
            type: "prose",
            text: error instanceof Error ? error.message : "The policy change could not be applied.",
          }],
        };
      }
    }

    return {
      blocks: [{
        type: "policy_change",
        text: "I've prepared this policy change. Aegis requires your signature for any policy change — sign in your wallet to apply it.",
        patch,
        changes,
        applied: false,
      }],
      title: "Policy change",
    };
  }

  /**
   * Translate a parsed policy_change into a concrete {@link PolicyUpdate} patch
   * plus human before→after rows, validating against the same invariants the
   * on-chain `update_policy` enforces (non-zero, maxPerTx ≤ dailyLimit) so the
   * user gets a friendly message instead of an on-chain rejection.
   */
  private buildPolicyPatch(
    policy: PolicyView,
    action: Extract<ParsedAction, { kind: "policy_change" }>,
  ): { patch: PolicyUpdate; changes: PolicyChangeRow[] } | { error: string } {
    const sol = (lamports: bigint) => `${formatSol(lamports)} SOL`;

    if (action.field === "pause") {
      const paused = Boolean(action.paused);
      if (policy.paused === paused) {
        return { error: paused ? "The agent is already paused." : "The agent is not paused." };
      }
      return {
        patch: { paused },
        changes: [{ label: "Agent transfers", from: policy.paused ? "Paused" : "Active", to: paused ? "Paused" : "Active" }],
      };
    }

    if (action.field === "expiry") {
      const hours = action.expiryHours ?? 0;
      if (!(hours > 0)) return { error: "Tell me how long to extend the session, e.g. \"extend my session by 24 hours\"." };
      const expiryTs = nowSeconds() + Math.round(hours * 3600);
      const rel = hours >= 24 ? `${(hours / 24).toFixed(hours % 24 === 0 ? 0 : 1)}d` : `${hours}h`;
      return {
        patch: { expiryTs },
        changes: [{ label: "Session expiry", from: `unix ${policy.expiryTs}`, to: `unix ${expiryTs} (~${rel} from now)` }],
      };
    }

    // daily_limit / max_per_tx — both are SOL amounts.
    let amount: bigint;
    try {
      amount = parseHumanUnits(action.amountHuman ?? "", SOL_DECIMALS);
    } catch {
      return { error: `"${action.amountHuman ?? ""}" isn't a valid SOL amount. Try e.g. "change my daily limit to 10 SOL".` };
    }
    if (amount <= 0n) return { error: "The new limit has to be greater than zero." };

    // The program only requires each limit to be > 0 (there is intentionally no
    // maxPerTx <= dailyLimit rule — the per-tx cap and the daily cap are
    // independent gates), so we don't invent a cross-constraint here.
    if (action.field === "daily_limit") {
      return {
        patch: { dailyLimit: amount },
        changes: [{ label: "Daily limit", from: sol(policy.dailyLimit), to: sol(amount) }],
      };
    }

    return {
      patch: { maxPerTx: amount },
      changes: [{ label: "Max per transaction", from: sol(policy.maxPerTx), to: sol(amount) }],
    };
  }

  /** Non-throwing companion to {@link assertBackendOwnerSigningAvailable}. */
  private backendOwnerSigningAvailable(): boolean {
    return Boolean(
      this.config.ownerAddress
      && this.config.ownerKeypair
      && this.config.ownerKeypair.publicKey.equals(this.config.ownerAddress),
    );
  }

  private async saveContactBlock(
    label: string,
    address: string,
  ): Promise<{ blocks: AgentBlock[]; title?: string }> {
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(address);
    } catch {
      return {
        blocks: [{
          type: "clarify",
          text: `"${address}" is not a valid Solana address, so I didn't save it. Paste a base58 address and try again.`,
          options: [],
        }],
      };
    }
    const cleanLabel = label.trim();
    const entry: AddressBookEntry = {
      label: cleanLabel.toLowerCase(),
      name: cleanLabel,
      address: pubkey.toBase58(),
    };
    this.addressBook.add(entry);
    this.state.contacts = [
      entry,
      ...this.state.contacts.filter((c) => c.address !== entry.address && c.label !== entry.label),
    ];
    const short = `${entry.address.slice(0, 4)}…${entry.address.slice(-4)}`;
    return {
      blocks: [{
        type: "notice",
        tone: "success",
        text: `Saved "${entry.name}" → ${short}. Manage it in Policy → Advanced → Address book.`,
      }],
    };
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
    // drive amount parsing and display, so they must be the real ones.
    const token = await this.withVerifiedDecimals(this.token(action.asset));
    if (!token) return { blocks: [this.unverifiedDecimalsBlock(action.asset.toUpperCase())] };
    const amount = parseHumanUnits(action.amountHuman, token.decimals);
    const preview = await this.previewTransfer(token, amount, resolved.entry.address);
    const proposal = this.storeTransferProposal({
      token,
      amount,
      recipientName: resolved.entry.name,
      recipientAddress: resolved.entry.address,
      recipientNote: resolved.entry.note,
      preview,
    });

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

  /**
   * Simulate a transfer through Aegis without storing anything. Shared by
   * one-off sends, DCA fires, and basket previews so every path runs the same
   * on-chain simulation + policy verdict.
   */
  private async previewTransfer(
    token: TokenInfo,
    amount: bigint,
    recipientAddress: string,
  ): Promise<TransferSimulation> {
    const recipient = new PublicKey(recipientAddress);
    if (token.symbol === "SOL") return this.aegis.simulateAgentTransfer(recipient, amount);
    return this.aegis.simulateAgentTransferSpl(recipient, token, amount);
  }

  /**
   * Store a simulated transfer as a proposal (plus a rejected-activity row when
   * blocked, matching the one-off send path). Pure bookkeeping — no chain I/O.
   */
  private storeTransferProposal(args: {
    token: TokenInfo;
    amount: bigint;
    recipientName: string;
    recipientAddress: string;
    recipientNote?: string;
    preview: TransferSimulation;
  }): ActionProposal {
    const proposal: ActionProposal = {
      id: this.id("p"),
      detail: {
        kind: "transfer",
        amount: args.amount,
        asset: args.token,
        recipientName: args.recipientName,
        recipientAddress: args.recipientAddress,
        recipientNote: args.recipientNote,
      },
      networkFee: args.preview.networkFee,
      simulation: args.preview.simulation,
      check: args.preview.check,
      state: args.preview.check.allowed ? "pending" : "blocked",
    };
    this.state.proposals[proposal.id] = proposal;

    if (!args.preview.check.allowed) {
      this.state.activity = [
        {
          id: this.id("a"),
          kind: "transfer",
          label: args.recipientName,
          asset: args.token.symbol,
          amount: args.amount,
          decimals: args.token.decimals,
          result: "rejected",
          reason: args.preview.check.reason,
          reasonCode: args.preview.check.reasonCode,
          ts: nowSeconds(),
        },
        ...this.state.activity,
      ];
    }
    return proposal;
  }

  /** Resolve a DCA/basket recipient: named contact, or the owner's own wallet. */
  private resolveSelfOrContact(
    recipient: string | undefined,
  ): { address: string; name: string; note?: string } | { clarify: string; options: ClarifyOption[] } {
    if (!recipient) {
      return {
        address: this.requireOwnerWallet().toBase58(),
        name: "you",
      };
    }
    const resolved = this.addressBook.resolve(recipient);
    if (resolved.kind !== "exact") {
      return { clarify: resolved.question, options: resolved.options };
    }
    return { address: resolved.entry.address, name: resolved.entry.name, note: resolved.entry.note };
  }

  /** Strict token lookup (no SYSTEM_PROGRAM fallback): DCA/baskets need a real mint. */
  private knownToken(symbol: string): TokenInfo | undefined {
    const normalized = symbol.trim().replace(/^\$/, "").toUpperCase();
    return this.config.tokens.find((item) => item.symbol.toUpperCase() === normalized);
  }

  private async scheduleDcaBlock(
    action: Extract<ParsedAction, { kind: "schedule_dca" }>,
    threadId?: string,
  ): Promise<{ blocks: AgentBlock[]; title?: string }> {
    const known = this.knownToken(action.asset);
    if (!known) {
      return {
        blocks: [{
          type: "clarify",
          text: `"${action.asset}" isn't a configured token, so I can't schedule buys for it. Try one of: ${this.config.tokens.map((t) => t.symbol).join(", ")}.`,
          options: [],
        }],
      };
    }
    // Resolve the real scale before storing an amount: a schedule persists its
    // per-fire amount in base units, so a wrong exponent is baked in forever.
    const token = await this.withVerifiedDecimals(known);
    if (!token) return { blocks: [this.unverifiedDecimalsBlock(known.symbol)] };
    let amount: bigint;
    try {
      amount = parseHumanUnits(action.amountHuman, token.decimals);
    } catch {
      return {
        blocks: [{
          type: "clarify",
          text: `"${action.amountHuman}" isn't a valid ${token.symbol} amount. Try e.g. "buy $50 ${token.symbol} every Monday".`,
          options: [],
        }],
      };
    }
    if (amount <= 0n) {
      return {
        blocks: [{ type: "clarify", text: "The recurring amount has to be greater than zero.", options: [] }],
      };
    }

    const target = this.resolveSelfOrContact(action.recipient);
    if ("clarify" in target) {
      return { blocks: [{ type: "clarify", text: target.clarify, options: target.options }] };
    }

    const human = formatUnits(amount, token.decimals);
    // Two identical schedules would double-fire the same buy, so the second
    // identical request is a no-op with an explanation — never a silent double.
    const duplicate = this.state.schedules.find(
      (s) =>
        s.asset === token.symbol
        && s.amount === amount
        && s.recipientAddress === target.address
        && sameCadence(s.cadence, action.cadence),
    );
    if (duplicate) {
      return {
        blocks: [{
          type: "notice",
          tone: "info",
          text: `You already have ${human} ${token.symbol} ${describeCadence(action.cadence)} for ${target.name} scheduled — I didn't create a duplicate. Stop it in Activity → Recurring buys to replace it.`,
        }],
        title: `${token.symbol} recurring buy`,
      };
    }

    const nowMs = Date.now();
    const schedule: DcaSchedule = {
      id: this.id("s"),
      asset: token.symbol,
      amount,
      decimals: token.decimals,
      recipientAddress: target.address,
      recipientName: target.name,
      cadence: action.cadence,
      nextFireTs: advanceCadence(action.cadence, nowMs),
      createdAt: nowMs,
      threadId: threadId ?? "t-welcome",
    };
    this.state.schedules = [schedule, ...this.state.schedules];

    return {
      blocks: [{
        type: "notice",
        tone: "success",
        text: `Scheduled ${human} ${token.symbol} ${describeCadence(action.cadence)} for ${target.name} — I'll propose each buy for your signature. Nothing moves until you sign.`,
      }],
      title: `${token.symbol} recurring buy`,
    };
  }

  private async basketBlock(
    action: Extract<ParsedAction, { kind: "basket_buy" }>,
  ): Promise<{ blocks: AgentBlock[]; title?: string }> {
    const constituents = resolveBasket(action.basket);
    if (!constituents) {
      return {
        blocks: [{
          type: "clarify",
          text: `I don't know the "${action.basket}" basket. Available: ${availableBaskets().join(", ")} — e.g. "buy ai basket $50".`,
          options: availableBaskets().map((label) => ({ label, value: label })),
        }],
      };
    }
    const totalUsd = Number(action.amountHuman);
    if (!Number.isFinite(totalUsd) || totalUsd <= 0) {
      return {
        blocks: [{
          type: "clarify",
          text: `"${action.amountHuman}" isn't a valid USD total. Try e.g. "buy ai basket $50".`,
          options: [],
        }],
      };
    }

    const target = this.resolveSelfOrContact(action.recipient);
    if ("clarify" in target) {
      return { blocks: [{ type: "clarify", text: target.clarify, options: target.options }] };
    }

    const tokens = new Map<string, TokenInfo>();
    for (const symbol of constituents) {
      const known = this.knownToken(symbol);
      if (!known) {
        return {
          blocks: [{
            type: "clarify",
            text: `${symbol} isn't a configured token right now, so I can't build this basket. Try a single-stock buy instead.`,
            options: [],
          }],
        };
      }
      // All-or-clarify extends to scale: one unconfirmable mint voids the
      // basket rather than splitting a total across a guessed exponent.
      const token = await this.withVerifiedDecimals(known);
      if (!token) return { blocks: [this.unverifiedDecimalsBlock(symbol)] };
      tokens.set(symbol, token);
    }

    // Price every constituent BEFORE simulating anything: a missing price
    // clarifies the whole basket — never a guessed split.
    const prices = await this.basketPriceSource(constituents);
    const shares = splitBasket(totalUsd, constituents, prices, (symbol) => tokens.get(symbol)!.decimals);
    if (!shares) {
      return {
        blocks: [{
          type: "clarify",
          text: `I can't price every stock in this basket right now (PreStocks quotes unavailable). Try again shortly, or buy a single stock.`,
          options: [],
        }],
      };
    }

    // All-or-clarify: simulate every constituent first. A single blocked share
    // voids the basket and stores nothing — no partial proposals, no activity.
    const previews = new Map<string, TransferSimulation>();
    for (const share of shares) {
      const preview = await this.previewTransfer(tokens.get(share.symbol)!, share.amount, target.address);
      if (!preview.check.allowed) {
        return {
          blocks: [{
            type: "clarify",
            text: `Basket blocked: ${share.symbol} would be rejected (${preview.check.reason ?? "policy"}). Nothing was proposed — adjust your caps, or buy the allowed stocks individually.`,
            options: [],
          }],
        };
      }
      previews.set(share.symbol, preview);
    }

    const blocks: AgentBlock[] = [];
    for (const share of shares) {
      const token = tokens.get(share.symbol)!;
      const proposal = this.storeTransferProposal({
        token,
        amount: share.amount,
        recipientName: target.name,
        recipientAddress: target.address,
        preview: previews.get(share.symbol)!,
      });
      blocks.push({
        type: "proposal",
        text: `Basket share ${blocks.length + 1} of ${shares.length}: ${formatUnits(share.amount, token.decimals)} ${share.symbol} (~$${(totalUsd / shares.length).toFixed(2)}).`,
        proposalId: proposal.id,
      });
    }
    return { blocks, title: `${action.basket} basket` };
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

  /**
   * A token with a scale that is safe to do amount math against.
   *
   * SOL and the configured SPL tokens carry known decimals. PreStocks mints do
   * not: the API omits decimals and the universe fills in a placeholder, so
   * parsing "40 OPENAI" against it could be off by orders of magnitude. For
   * those, the real scale is read from the chain (mainnet, where the mints
   * live) and cached — and if it cannot be confirmed we return `undefined`
   * so the caller refuses the action instead of moving a guessed amount.
   */
  private async withVerifiedDecimals(token: TokenInfo): Promise<TokenInfo | undefined> {
    if (!hasProvisionalDecimals(token.symbol, this.config.stockDecimals)) return token;
    const decimals = await resolveMintDecimals(getResearchConnection(this.config), token.mint);
    if (decimals === undefined) return undefined;
    return decimals === token.decimals ? token : { ...token, decimals };
  }

  /** The message shown when a mint's scale cannot be confirmed. */
  private unverifiedDecimalsBlock(symbol: string): AgentBlock {
    return {
      type: "clarify",
      text:
        `I can't confirm the on-chain decimals for ${symbol} right now, and I won't guess ` +
        "the amount — getting that wrong would move the wrong quantity. Try again shortly.",
      options: [],
    };
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

  private snapshot(): StoredProviderState {
    return {
      threads: this.state.threads,
      proposals: this.state.proposals,
      activity: this.state.activity,
      contacts: this.state.contacts,
      schedules: this.state.schedules,
      removedContacts: this.state.removedContacts,
    };
  }

  /**
   * Write this provider's document, compare-and-swapping on the revision it
   * was loaded at.
   *
   * On a conflict another *instance* wrote first. For the conversational
   * document the resolution is to take the newer revision and write our
   * snapshot over it — the same last-write-wins the blind write always had,
   * except now it is deliberate, bounded, and logged instead of invisible.
   * The one place that must NOT resolve this way is claiming a proposal for
   * execution, which uses {@link casSave} directly and re-reads instead.
   */
  private async persist(): Promise<void> {
    return this.enqueueWrite(async () => {
      try {
        this.rev = await this.repository.save(this.ownerKey, this.snapshot(), this.rev);
      } catch (error) {
        if (!(error instanceof PraxisConflictError)) throw error;
        logger.warn("praxis.state_conflict_overwrite", { ownerKey: this.ownerKey, rev: this.rev });
        const latest = await this.repository.load(this.ownerKey);
        this.rev = latest?.rev ?? 0;
        this.rev = await this.repository.save(this.ownerKey, this.snapshot(), this.rev);
      }
    });
  }

  /**
   * Write at exactly the loaded revision. Propagates {@link PraxisConflictError}
   * so the caller can reload and re-decide rather than clobbering.
   */
  private async casSave(): Promise<void> {
    return this.enqueueWrite(async () => {
      this.rev = await this.repository.save(this.ownerKey, this.snapshot(), this.rev);
    });
  }

  /**
   * Serialize this provider's own writes.
   *
   * `newThread` persists in the background while its caller (`send`) goes on
   * to `await commit()`. Both writes start from the same `rev`, so without a
   * queue the provider compare-and-swaps against itself: one write wins and
   * the other logs a spurious conflict. Chaining them means each write reads
   * the revision the previous one produced, and a surfaced conflict then
   * means what it should — a genuinely concurrent writer elsewhere.
   */
  private enqueueWrite(write: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(write, write);
    // Keep the chain alive after a rejection so one failure can't wedge every
    // later write; the rejection still propagates to this call's caller.
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  /**
   * Take exclusive ownership of a pending proposal before anything is signed.
   *
   * `signProposal` previously flipped the proposal to `signing`, saved, and
   * executed — which stops a duplicate POST on the *same* instance but not on
   * another one, because that instance had already read the proposal as
   * `pending` and would submit its own `agent_transfer`. Aegis caps bound the
   * damage, but the user still sees two transfers leave the vault.
   *
   * The claim is a compare-and-swap: only the writer whose revision is still
   * current wins. A loser reloads, finds the proposal no longer `pending`, and
   * returns without submitting. Returns the claimed proposal, or `undefined`
   * when someone else claimed it (or it is no longer actionable).
   */
  private async claimProposalForExecution(proposalId: string): Promise<ActionProposal | undefined> {
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
      const proposal = this.state.proposals[proposalId];
      if (!proposal) {
        if (attempt === 0) throw new PraxisNotFoundError(`unknown proposal ${proposalId}`);
        return undefined; // Vanished under us (compaction) — nothing to sign.
      }
      if (proposal.state !== "pending") return undefined;

      proposal.state = "signing";
      try {
        this.notify();
        await this.casSave();
        return proposal;
      } catch (error) {
        if (!(error instanceof PraxisConflictError)) throw error;
        // Someone else wrote first. Adopt their state and re-read the proposal:
        // if they claimed it we stop; if they changed something unrelated we
        // retry the claim against the fresh revision.
        logger.warn("praxis.proposal_claim_conflict", { proposalId, attempt });
        await this.reload();
      }
    }
    logger.warn("praxis.proposal_claim_exhausted", { proposalId });
    return undefined;
  }

  /** Re-read this wallet's document, replacing the in-memory snapshot. */
  private async reload(): Promise<void> {
    const latest = await this.repository.load(this.ownerKey);
    this.rev = latest?.rev ?? 0;
    const next = latest?.state;
    this.state = {
      ...this.state,
      threads: next?.threads.length ? next.threads : this.state.threads,
      proposals: next?.proposals ?? {},
      activity: next?.activity ?? [],
      contacts: next?.contacts ?? [],
      schedules: next?.schedules ?? [],
      removedContacts: next?.removedContacts ?? [],
    };
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
