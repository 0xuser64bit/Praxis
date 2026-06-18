/**
 * Praxis SDK wire types — the JSON contract exposed by `/api/praxis/*`.
 *
 * MONEY RULE: every monetary value crosses the wire as a **decimal string of
 * integer base units** (lamports for SOL, token base units for SPL) — never a
 * float. On the server these are `bigint`; the API serializes them to strings.
 * The SDK keeps them as strings and leaves bigint conversion to the caller
 * (see `toBaseUnits` / `fromBaseUnits` in `units.ts`). This file intentionally
 * mirrors `@praxis/shared` but with `string` money, so the SDK ships a
 * self-contained type contract with no internal workspace dependency.
 */

/** A base58-encoded Solana public key. */
export type Address = string;

/** Integer base units as a decimal string (e.g. "500000000" = 0.5 SOL). */
export type BaseUnitString = string;

/** Mirrors the on-chain `ActionKind` discriminants. */
export enum ActionKind {
  Transfer = 0,
  TransferSpl = 1,
}

/** Why Aegis rejected an agent action. Mirrors the on-chain enum order. */
export enum RejectReason {
  Unauthorized = 0,
  Paused = 1,
  Expired = 2,
  OverPerTx = 3,
  OverDaily = 4,
  RecipientNotAllowed = 5,
  Overflow = 6,
  MintNotAllowed = 7,
}

// --- Auth ------------------------------------------------------------------

/** Returned by `POST /auth/challenge`; sign `message` to prove wallet ownership. */
export interface WalletChallenge {
  address: Address;
  /** Opaque signed token echoed back to `/auth/verify`. */
  nonce: string;
  /** The exact UTF-8 string the wallet must sign. */
  message: string;
  /** ISO-8601 expiry of the challenge. */
  expiresAt: string;
}

export interface SessionInfo {
  authenticated: boolean;
  /** The signed-in wallet (owner). Present whenever `authenticated` is true. */
  walletAddress: Address;
  /** Unix seconds at which the session expires (from `GET /auth/session`). */
  expiresAt?: number;
}

// --- Tokens / address book -------------------------------------------------

export interface TokenInfo {
  symbol: string;
  mint: Address;
  decimals: number;
  verified: boolean;
}

export interface AddressBookEntry {
  label: string;
  name: string;
  address: Address;
  note?: string;
}

// --- Policy ----------------------------------------------------------------

export interface PolicyView {
  address: Address;
  owner: Address;
  /** `11111…1111` (default) once the agent key is revoked. */
  agentAuthority: Address;
  maxPerTx: BaseUnitString;
  dailyLimit: BaseUnitString;
  spentToday: BaseUnitString;
  dayStartTs: number;
  allowedPrograms: Address[];
  /** Empty array means "any recipient allowed". */
  allowedRecipients: Address[];
  allowedMints: Address[];
  expiryTs: number;
  paused: boolean;
  vaultBalance: BaseUnitString;
  tokenMint: Address;
  tokenMaxPerTx: BaseUnitString;
  tokenDailyLimit: BaseUnitString;
  tokenSpentToday: BaseUnitString;
  tokenDayStartTs: number;
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  reasonCode?: RejectReason;
  spentToday: BaseUnitString;
  dailyLimit: BaseUnitString;
  remaining: BaseUnitString;
}

export interface PolicyUpdate {
  maxPerTx?: BaseUnitString;
  dailyLimit?: BaseUnitString;
  expiryTs?: number;
  paused?: boolean;
}

export interface TokenEnvelopeConfig {
  tokenMint: Address;
  tokenMaxPerTx: BaseUnitString;
  tokenDailyLimit: BaseUnitString;
}

export type AllowListKind = "programs" | "recipients" | "mints";

// --- Proposals -------------------------------------------------------------

export interface TransferDetail {
  kind: "transfer";
  amount: BaseUnitString;
  asset: TokenInfo;
  recipientName: string;
  recipientAddress: Address;
  recipientNote?: string;
}

export interface SwapDetail {
  kind: "swap";
  amountIn: BaseUnitString;
  assetIn: TokenInfo;
  estAmountOut: BaseUnitString;
  assetOut: TokenInfo;
  route: string;
  priceImpactBps: number;
}

export type ProposalDetail = TransferDetail | SwapDetail;

export type ProposalState = "pending" | "signing" | "signed" | "blocked" | "cancelled";

export interface ActionProposal {
  id: string;
  detail: ProposalDetail;
  networkFee: BaseUnitString;
  simulation: string;
  check: PolicyCheckResult;
  state: ProposalState;
  sig?: string;
}

// --- Conversation ----------------------------------------------------------

export interface ClarifyOption {
  label: string;
  value: string;
  hint?: string;
}

export interface ResearchMetric {
  label: string;
  value: string;
  trend?: "up" | "down" | "flat";
}

export interface ResearchData {
  token: string;
  mint: Address;
  metrics: ResearchMetric[];
  summary: string;
}

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
  | {
      type: "policy_change";
      text: string;
      patch: PolicyUpdate;
      changes: PolicyChangeRow[];
      applied: boolean;
    };

export type UserMessage = { id: string; role: "user"; ts: number; text: string };
export type AgentMessage = { id: string; role: "agent"; ts: number; blocks: AgentBlock[] };
export type Message = UserMessage | AgentMessage;

export interface Thread {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}

// --- Activity --------------------------------------------------------------

export interface ActivityEntry {
  id: string;
  kind: "transfer" | "swap";
  label: string;
  asset: string;
  amount: BaseUnitString;
  decimals: number;
  result: "allowed" | "rejected";
  reason?: string;
  reasonCode?: RejectReason;
  ts: number;
  sig?: string;
}

// --- Owner transactions (wallet-signed path) -------------------------------

export interface UnsignedOwnerTransaction {
  /** base64-encoded unsigned transaction for the owner wallet to sign. */
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

/**
 * An {@link UnsignedOwnerTransaction} after the owner wallet has signed it — the
 * base64 `transaction` now carries the owner's signature. This is what you pass
 * to {@link PraxisClient.submitOwnerTransaction}. Signing a Solana transaction
 * requires a transaction-capable wallet (browser wallet adapter / `@solana/web3.js`);
 * the SDK's `keypairSigner` only signs the sign-in *message*, not transactions.
 */
export type SignedOwnerTransaction = UnsignedOwnerTransaction;

/** Typed owner action accepted by `POST /owner/build`. */
export type OwnerAction =
  | { kind: "bootstrapPolicy"; fundLamports?: BaseUnitString }
  | { kind: "fundVault"; amount: BaseUnitString }
  | { kind: "withdrawVault"; amount: BaseUnitString }
  | { kind: "closePolicy" }
  | { kind: "revoke" }
  | { kind: "rotate" }
  | { kind: "updatePolicy"; patch: PolicyUpdate }
  | { kind: "allowList"; listKind: AllowListKind; address: Address; mode: "add" | "remove" };
