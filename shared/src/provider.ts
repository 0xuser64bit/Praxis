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
  mint: Address;
  metrics: ResearchMetric[];
  /** A neutral, no-advice summary. */
  summary: string;
}

export interface ResearchMetric {
  label: string;
  /** Already display-formatted market data (not policy-governed money). */
  value: string;
  /** Optional directional hint for styling ("up" | "down" | "flat"). */
  trend?: "up" | "down" | "flat";
}

export type AgentBlock =
  | { type: "prose"; text: string }
  | { type: "clarify"; text: string; options: ClarifyOption[] }
  | { type: "proposal"; text: string; proposalId: string }
  | { type: "research"; text: string; data: ResearchData };

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

export type ProviderConnectionState =
  | { mode: "mock"; phase: "ready" }
  | { mode: "api"; phase: "loading" | "ready" | "error"; message?: string };

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
  /** Start a fresh empty thread; returns its id. */
  newThread(): string;

  // --- policy dashboard (owner) ---
  /** Initialize a missing wallet-owned Aegis policy and fund its SOL vault. */
  bootstrapPolicy(): Promise<void>;
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
