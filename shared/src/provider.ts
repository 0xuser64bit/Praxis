/**
 * The Praxis data provider — the single seam between the UI and its data.
 *
 * EVERY surface (conversation, policy dashboard, activity log) talks to data
 * ONLY through {@link PraxisProvider}. The mock implementation lives in the
 * frontend (`components/app/mock`); a real agent backend implements the same
 * interface against Aegis + an RPC. Swapping one for the other is a one-line
 * change at the context provider — the UI never changes.
 *
 * MONEY RULE (inherited from `types.ts`): every monetary value here is
 * {@link BaseUnits} (`bigint` integer base units) in memory. A networked
 * implementation serializes them to decimal strings on the wire via
 * `serde.ts`; the UI converts to human units only at the display edge.
 */

import type {
  Address,
  BaseUnits,
  PolicyView,
  PolicyCheckResult,
  RejectReason,
} from "./types";

// ---------------------------------------------------------------------------
// Address book — labels → addresses. Resolving a name that is ambiguous or
// unknown must ASK (a clarifying question), never guess (spec §12.ii).
// ---------------------------------------------------------------------------

export interface AddressBookEntry {
  /** Human alias, lowercased for matching ("maya"). */
  label: string;
  /** Display name ("Maya Patel"). */
  name: string;
  address: Address;
  /** Optional context surfaced on resolution ("3 prior transactions"). */
  note?: string;
}

// ---------------------------------------------------------------------------
// Tokens — the agent's recognized mints, used for swap previews and the
// verified-mint allow-list check.
// ---------------------------------------------------------------------------

export interface TokenInfo {
  symbol: string;
  mint: Address;
  /** Decimal places for base-unit ⇄ human conversion. */
  decimals: number;
  /** True iff this mint is in the policy's verified/allowed set. */
  verified: boolean;
}

// ---------------------------------------------------------------------------
// Proposals — an action the agent proposes, enriched with the simulated
// outcome and the Aegis policy verdict so the UI can render one preview card.
// ---------------------------------------------------------------------------

/**
 * A native-SOL transfer. Mirrors the on-chain `ProposedAction` ("transfer")
 * and is what the executor would route through `agent_transfer`.
 */
export interface TransferDetail {
  kind: "transfer";
  /** lamports. */
  amount: BaseUnits;
  asset: TokenInfo;
  recipientName: string;
  recipientAddress: Address;
  recipientNote?: string;
  /**
   * The destination is the owner's own wallet.
   *
   * Derived from the address, not from how the request was phrased, so it is
   * true whenever it is true — a bare `buy`, a schedule with no recipient, or
   * an owner who pasted their own address. Surfaces are expected to say "your
   * wallet" rather than render the contact name "you", which on a labelled
   * column reads as a missing value.
   */
  toSelf?: true;
  /**
   * Server-computed USD value of `amount`, as a decimal string, when a real
   * price is available (tokenized stocks price from the PreStocks API).
   *
   * Absent means "we don't know" — the UI then shows no dollar figure rather
   * than a made-up one. It is display-only and never feeds base-unit math.
   */
  usdEstimate?: string;
}

/**
 * A swap. NOTE: `agent_swap` is not on-chain yet (spec stretch / v2), so a swap
 * verdict is an AGENT-LAYER policy check (verified-mint / allowed-program),
 * never an on-chain `RejectReason`. Surfaced here so the demo can show the
 * allow-list rejecting an unverified mint.
 */
export interface SwapDetail {
  kind: "swap";
  amountIn: BaseUnits;
  assetIn: TokenInfo;
  /** Estimated output (base units of `assetOut`). */
  estAmountOut: BaseUnits;
  assetOut: TokenInfo;
  /** Display route ("USDC › Orca › JUP"). */
  route: string;
  /** Price impact in basis points, for display. */
  priceImpactBps: number;
}

export type ProposalDetail = TransferDetail | SwapDetail;

export type ProposalState =
  | "pending"
  | "signing"
  | "signed"
  | "blocked"
  | "cancelled";

export interface ActionProposal {
  id: string;
  detail: ProposalDetail;
  /** Estimated network fee (lamports), for display. */
  networkFee: BaseUnits;
  /** Plain-language simulated outcome ("Will succeed"). */
  simulation: string;
  /** Simulation-first Aegis verdict — allowed, or rejected + reason. */
  check: PolicyCheckResult;
  state: ProposalState;
  /** Tx signature once signed (or the failed attempt's signature). */
  sig?: string;
}

// ---------------------------------------------------------------------------
// Recurring buys — mechanical schedules. Each fire emits one transfer
// proposal through the same policy checks as a one-off buy; nothing ever
// auto-signs. Amount is base units of the asset (bigint in memory, decimal
// string on the wire, per the money rule).
// ---------------------------------------------------------------------------

/** When a recurring buy fires. `weekday`: 0=Sunday..6=Saturday (UTC). */
export type DcaCadenceView =
  | { type: "daily" }
  | { type: "weekly"; weekday: number }
  | { type: "monthly"; day: number };

export interface DcaScheduleView {
  id: string;
  /** Canonical asset symbol, e.g. "OPENAI". */
  asset: string;
  /** Per-fire amount in the token's base units (never float). */
  amount: BaseUnits;
  decimals: number;
  recipientAddress: Address;
  recipientName: string;
  cadence: DcaCadenceView;
  /** Unix milliseconds of the next fire. */
  nextFireTs: number;
  createdAt: number;
  /** Thread the schedule was created in (fires append proposals there). */
  threadId: string;
}

// ---------------------------------------------------------------------------
// Conversation — a multi-turn thread of user lines and agent blocks. The agent
// can reply with prose, ask a clarifying question, propose an action, or return
// read-only research.
// ---------------------------------------------------------------------------

/** A tappable option offered when the agent needs the user to disambiguate. */
export interface ClarifyOption {
  /** Chip label ("Alex Kim"). */
  label: string;
  /** The line sent back to the agent when tapped. */
  value: string;
  /** Optional secondary line (an address / context). */
  hint?: string;
}

/** Read-only research, distilled. Data only — never buy/sell/hold advice (§12.iv). */
export interface ResearchData {
  token: string;
  /**
   * Project name from the indexer ("OFFICIAL TRUMP"), when it differs from
   * the ticker. On a chain where four live mints answer to TRUMP, the ticker
   * alone does not say which one the card is about.
   */
  name?: string;
  mint: Address;
  metrics: ResearchMetric[];
  /** How the card was produced, in the order the steps ran. */
  sources?: ResearchSource[];
  /** A neutral, no-advice summary. */
  summary: string;
}

/**
 * One step in how a research card was produced: which source was asked, and
 * what it said. A read-only card whose whole pitch is "data, no advice" has
 * to be able to show its working — "unavailable" means something different
 * when the indexer has no pair than when the RPC refused the query.
 */
export interface ResearchSource {
  /** "Solana RPC", "DexScreener", "PreStocks", "Token resolution". */
  label: string;
  status: "ok" | "partial" | "unavailable";
  /** What was asked and what came back. */
  detail: string;
}

export interface ResearchMetric {
  label: string;
  /**
   * Already display-formatted market data (not policy-governed money), and
   * abbreviated where a raw figure would be unreadable — a supply of
   * "87994397952881.85356" is a digit-counting exercise, not a number.
   */
  value: string;
  /**
   * The full-precision figure behind an abbreviated `value`, surfaced on
   * hover. Rounding is for reading; the exact number stays one gesture away
   * rather than being destroyed at the formatter.
   */
  exact?: string;
  /**
   * Why this metric is missing or what it measures. Shown on hover, and the
   * difference between "unavailable" as a shrug and as an explanation.
   */
  note?: string;
  /** Optional directional hint for styling ("up" | "down" | "flat"). */
  trend?: "up" | "down" | "flat";
}

/** One before→after row in a policy change, pre-formatted for display. */
export interface PolicyChangeRow {
  label: string;
  from: string;
  to: string;
}

export type AgentBlock =
  | { type: "prose"; text: string }
  | { type: "clarify"; text: string; options: ClarifyOption[] }
  | { type: "proposal"; text: string; proposalId: string }
  | { type: "research"; text: string; data: ResearchData }
  | { type: "notice"; tone: "success" | "info"; text: string }
  /**
   * A parsed, validated change to the owner's Aegis policy. `applied` is true
   * when the backend already committed it on-chain (backend owner key present);
   * otherwise the client renders an "Apply & sign" affordance that submits
   * `patch` through the wallet-signed owner-action path.
   */
  | {
      type: "policy_change";
      text: string;
      patch: PolicyUpdate;
      changes: PolicyChangeRow[];
      applied: boolean;
    };

export type Message =
  | { id: string; role: "user"; ts: number; text: string }
  | { id: string; role: "agent"; ts: number; blocks: AgentBlock[] };

export interface Thread {
  id: string;
  title: string;
  messages: Message[];
  /** Unix seconds of last activity, for sidebar grouping. */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Activity log — every agent action with its policy result. Allowed transfers
// mirror the on-chain ActionLog; rejections are reconstructed from the failed
// transaction's typed error / event (or, for swaps, the agent-layer block).
// ---------------------------------------------------------------------------

export interface ActivityEntry {
  id: string;
  kind: "transfer" | "swap";
  /** Target label — recipient name or "USDC → JUP". */
  label: string;
  /**
   * Destination address for a transfer. Carried alongside the label because
   * the label is a lookup that can change (a contact renamed, removed, or
   * never saved) while the identity of the action cannot — it is what matches
   * a locally-recorded row to the on-chain record of the same transfer.
   */
  target?: Address;
  /** Primary asset symbol ("SOL"). */
  asset: string;
  /** Amount in base units of `asset`. */
  amount: BaseUnits;
  /** Decimals for `asset`, for display conversion. */
  decimals: number;
  result: "allowed" | "rejected";
  /** Plain-language reason; set iff rejected. */
  reason?: string;
  /** On-chain reject code; set iff reconstructed from an Aegis transfer error. */
  reasonCode?: RejectReason;
  /** Unix seconds. */
  ts: number;
  /** Tx signature, when from a landed/failed tx. */
  sig?: string;
}

// ---------------------------------------------------------------------------
// Owner mutations.
// ---------------------------------------------------------------------------

export interface PolicyUpdate {
  maxPerTx?: BaseUnits;
  dailyLimit?: BaseUnits;
  /** Unix seconds. */
  expiryTs?: number;
  paused?: boolean;
}

/**
 * Owner configuration of the dedicated SPL-token envelope (the on-chain
 * `configure_token`). Sets which single mint the agent may move via
 * `agent_transfer_spl` and its own caps (in the token's base units). Applying
 * this resets the token's rolling daily window.
 */
export interface TokenEnvelopeConfig {
  tokenMint: Address;
  tokenMaxPerTx: BaseUnits;
  tokenDailyLimit: BaseUnits;
}

export type AllowListKind = "programs" | "recipients" | "mints";

/**
 * Why a connection attempt failed, as a stable code rather than prose. Mirrors
 * `PraxisErrorCode` on the server: the client branches on this, never on the
 * wording of `message`. `policy_not_found` is the first-run state (the wallet
 * has no Aegis policy yet) and renders vault onboarding, not an error screen.
 */
export type ConnectionErrorCode =
  | "config_error"
  | "unauthorized"
  | "invalid_input"
  | "not_found"
  | "policy_not_found"
  | "rate_limited"
  | "internal_error";

export type ProviderConnectionState =
  | { mode: "mock"; phase: "ready" }
  | {
      mode: "api";
      phase: "loading" | "ready" | "error";
      message?: string;
      code?: ConnectionErrorCode;
      /** From `policy_not_found`: the PDA this wallet's policy will live at. */
      policyAddress?: string;
    };

// ---------------------------------------------------------------------------
// The provider interface itself.
//
// Reads are synchronous snapshots off an in-memory cache (a networked impl
// keeps the cache warm via its `subscribe` channel). Writes are async — they
// model the agent "thinking" and the chain "confirming," and resolve when the
// resulting state has been committed + broadcast to subscribers.
// ---------------------------------------------------------------------------

export interface PraxisProvider {
  // --- reads (snapshot) ---
  getThreads(): Thread[];
  getThread(id: string): Thread | undefined;
  getProposal(id: string): ActionProposal | undefined;
  getPolicy(): PolicyView;
  getActivity(): ActivityEntry[];
  getAddressBook(): AddressBookEntry[];
  /** True while the agent is composing a reply on the given thread. */
  isThinking(threadId: string): boolean;
  /** Connection health for API mode; mock mode is always ready. */
  getConnectionState(): ProviderConnectionState;

  // --- conversation ---
  /**
   * Send a user line. Creates a thread when `threadId` is null. Appends the
   * user message immediately, then (after the agent "thinks") the agent reply.
   */
  send(threadId: string | null, text: string): Promise<{ threadId: string }>;
  /** Sign a pending proposal — routes through Aegis, commits, logs the result. */
  signProposal(proposalId: string): Promise<void>;
  /** Dismiss a pending proposal without signing. */
  cancelProposal(proposalId: string): Promise<void>;
  /** List recurring-buy schedules (each fire emits one proposal; never signs). */
  getSchedules(): DcaScheduleView[];
  /** Stop a recurring-buy schedule. Unknown ids are a no-op (idempotent). */
  cancelSchedule(scheduleId: string): Promise<void>;
  /** Start a fresh empty thread; returns its id. */
  newThread(): string;

  // --- policy dashboard (owner) ---
  /**
   * Initialize a missing wallet-owned Aegis policy. Optionally fund its SOL
   * vault with `fundLamports` in the same transaction; pass 0n (or omit) to
   * create the policy now and fund it later via {@link fundVault}.
   */
  bootstrapPolicy(fundLamports?: BaseUnits): Promise<void>;
  /** Deposit SOL from the owner wallet into the policy's vault. */
  fundVault(amount: BaseUnits): Promise<void>;
  /** Withdraw SOL from the policy's vault back to the owner wallet (owner-only, uncapped). */
  withdrawVault(amount: BaseUnits): Promise<void>;
  /**
   * Tear the agent down: drain the vault to the owner and close the policy +
   * audit-log accounts (reclaiming rent). Irreversible; afterwards the wallet
   * has no policy and lands back on onboarding.
   */
  deleteAgent(): Promise<void>;
  updatePolicy(patch: PolicyUpdate): Promise<void>;
  /** Configure the SPL-token envelope (mint + token caps). */
  configureToken(config: TokenEnvelopeConfig): Promise<void>;
  /** Create missing vault/recipient associated token accounts for the configured SPL token. */
  prepareTokenAccounts(recipientAddresses?: Address[]): Promise<void>;
  /** The kill switch — zeroes the agent key and pauses the policy. */
  revokeAgent(): Promise<void>;
  /** Issue a fresh session key and unpause. */
  rotateAgent(): Promise<void>;
  addToAllowList(kind: AllowListKind, address: Address): Promise<void>;
  removeFromAllowList(kind: AllowListKind, address: Address): Promise<void>;
  /** Save (or rename) an address-book contact. Labels have no signing power. */
  addContact(label: string, address: Address): Promise<void>;
  /** Remove a contact by address or label (case-insensitive, idempotent). */
  removeContact(key: string): Promise<void>;

  // --- reactivity ---
  /** Subscribe to any state change. Returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void;
  /**
   * Monotonic version, bumped on every committed change. The stable snapshot
   * key for React's `useSyncExternalStore` (a networked impl bumps it whenever
   * its local cache is refreshed from the backend channel).
   */
  getVersion(): number;
}
