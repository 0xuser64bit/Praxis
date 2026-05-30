/**
 * Praxis ⇄ Aegis shared contract types.
 *
 * MONEY RULE (non-negotiable): every monetary value is an integer base unit
 * (lamports for SOL; token base units for SPL). In TypeScript that means
 * `bigint` in memory and a decimal `string` across JSON boundaries — NEVER a
 * `number` / float. The on-chain side is `u64`. See `BaseUnits` below.
 */

/** A base58-encoded Solana public key. */
export type Address = string;

/**
 * Integer base units (lamports / token base units). `bigint` in memory.
 * When this crosses a JSON boundary it is serialized as a decimal `string`
 * (see `serializeUnits` / `parseUnits` in `serde.ts`).
 */
export type BaseUnits = bigint;

// ---------------------------------------------------------------------------
// Enums — mirror the on-chain `ActionKind` / `RejectReason` (state.rs).
// Values are the on-chain u8 discriminants; keep them in sync.
// ---------------------------------------------------------------------------

/** The kind of action the agent proposed/executed. */
export enum ActionKind {
  /** Native SOL transfer (`agent_transfer`). */
  Transfer = 0,
  /** SPL-token transfer (`agent_transfer_spl`). */
  TransferSpl = 1,
}

/**
 * Why the on-chain program rejected an agent action. Mirrors the order of the
 * enforcement checks in `agent_transfer`. `None` (0-as-allowed) is represented
 * by the absence of a reason rather than a variant.
 */
export enum RejectReason {
  Unauthorized = 0,
  Paused = 1,
  Expired = 2,
  OverPerTx = 3,
  OverDaily = 4,
  RecipientNotAllowed = 5,
  Overflow = 6,
  /** SPL path: the transfer's mint is not the policy's configured `token_mint`. */
  MintNotAllowed = 7,
}

/** Human-readable labels for {@link RejectReason}, for previews and the log UI. */
export const REJECT_REASON_LABEL: Record<RejectReason, string> = {
  [RejectReason.Unauthorized]: "signer is not the registered agent key",
  [RejectReason.Paused]: "policy is paused / agent revoked",
  [RejectReason.Expired]: "agent session key has expired",
  [RejectReason.OverPerTx]: "exceeds the per-transaction limit",
  [RejectReason.OverDaily]: "exceeds the remaining daily limit",
  [RejectReason.RecipientNotAllowed]: "recipient is not in the allow-list",
  [RejectReason.Overflow]: "arithmetic overflow",
  [RejectReason.MintNotAllowed]: "mint is not the policy's configured token mint",
};

// ---------------------------------------------------------------------------
// ProposedAction — the agent's parsed intent (output of intent parsing, M2).
// ---------------------------------------------------------------------------

/** Parameters for a `transfer` action. Amount is base units. */
export interface TransferParams {
  /** Resolved destination address (after address-book resolution). */
  recipient: Address;
  /** Amount in base units (lamports for native SOL). */
  amount: BaseUnits;
}

/**
 * A typed, structured action the agent proposes. Phase 1 only emits `transfer`.
 * Modeled as a discriminated union so future kinds (e.g. `swap`) extend it
 * without widening `params` to `any`.
 */
export type ProposedAction = {
  kind: "transfer";
  params: TransferParams;
};

// ---------------------------------------------------------------------------
// PolicyView — a client-friendly mirror of the on-chain PolicyAccount.
// Field names/types track programs/aegis/src/state.rs::PolicyAccount.
// ---------------------------------------------------------------------------

export interface PolicyView {
  /** PDA address of this PolicyAccount. */
  address: Address;
  owner: Address;
  /** Registered agent session key; `11111…1111` (default) once revoked. */
  agentAuthority: Address;
  maxPerTx: BaseUnits;
  dailyLimit: BaseUnits;
  spentToday: BaseUnits;
  /** Unix seconds; start of the current rolling 24h window. */
  dayStartTs: number;
  allowedPrograms: Address[];
  /** Empty array means "any recipient allowed". */
  allowedRecipients: Address[];
  allowedMints: Address[];
  /** Unix seconds; the session key auto-expires at/after this. */
  expiryTs: number;
  paused: boolean;
  /** Live vault balance in base units (lamports), fetched alongside the policy. */
  vaultBalance: BaseUnits;

  // --- Dedicated SPL-token envelope (separate asset; its own caps/counter) ---
  /**
   * The single SPL mint the agent may move via `agent_transfer_spl`.
   * `11111…1111` (default) means SPL transfers are not configured/disabled.
   * Enforced on-chain: a token transfer's mint MUST equal this.
   */
  tokenMint: Address;
  /** Per-tx cap in the TOKEN's base units (not lamports). */
  tokenMaxPerTx: BaseUnits;
  /** Rolling daily cap in the token's base units. */
  tokenDailyLimit: BaseUnits;
  tokenSpentToday: BaseUnits;
  /** Unix seconds; start of the token's rolling 24h window. */
  tokenDayStartTs: number;
}

// ---------------------------------------------------------------------------
// PolicyCheckResult — the simulated/echoed outcome of the on-chain policy
// check, in plain language. Produced by the executor's simulate step (M2),
// and also reconstructable from a rejected transaction's typed error.
// ---------------------------------------------------------------------------

export interface PolicyCheckResult {
  allowed: boolean;
  /** Human-readable explanation; set iff `allowed === false`. */
  reason?: string;
  /** Typed on-chain rejection code; set iff the result came from Aegis. */
  reasonCode?: RejectReason;
  /** `spent_today` as it stands for this check (after any rollover reset). */
  spentToday: BaseUnits;
  dailyLimit: BaseUnits;
  /** `dailyLimit - spentToday`, floored at 0. */
  remaining: BaseUnits;
}

// ---------------------------------------------------------------------------
// ActionLogEntry — one row of the activity log (the audit trail surface).
// Allowed actions are sourced from the on-chain ActionLog ring buffer;
// rejected actions are reconstructed from failed-transaction logs/errors.
// ---------------------------------------------------------------------------

export interface ActionLogEntry {
  kind: ActionKind;
  amount: BaseUnits;
  target: Address;
  result: "allowed" | "rejected";
  /** Human-readable explanation; set iff `result === "rejected"`. */
  reason?: string;
  /** Typed on-chain rejection code when reconstructed from Aegis logs/errors. */
  reasonCode?: RejectReason;
  /** Unix seconds. */
  ts: number;
  /** Transaction signature, when the entry originates from a landed/failed tx. */
  sig?: string;
}
