import type {
  ActionProposal,
  ActivityEntry,
  AddressBookEntry,
  AgentBlock,
  Thread,
} from "@praxis/shared";
import type { DcaSchedule } from "../stocks/schedules";

/**
 * The durable slice of a wallet's provider state. Policy/activity that lives
 * on-chain is re-derived on refresh and is intentionally NOT persisted here —
 * only the off-chain conversation, proposals, and the rejected/synthesized
 * activity rows that have no on-chain home.
 */
export interface StoredProviderState {
  threads: Thread[];
  proposals: Record<string, ActionProposal>;
  activity: ActivityEntry[];
  contacts: AddressBookEntry[];
  /** Stocklana C06: mechanical DCA schedules (cron fires emit proposals). */
  schedules?: DcaSchedule[];
  /**
   * Tombstones for removed address-book entries (address or label). Lets a
   * removal stick even for env-seeded contacts, which are otherwise re-merged
   * from config on every fresh provider construction.
   */
  removedContacts?: string[];
}

export const STORE_VERSION = 1;
export const MAX_THREADS = 50;
export const MAX_ACTIVITY = 250;
export const MAX_SCHEDULES = 50;
export const MAX_REMOVED_CONTACTS = 200;

/**
 * Bound the persisted document: keep the newest threads/activity and drop
 * proposals no longer referenced by any retained thread (orphan GC). Pure and
 * shared by every storage backend so they compact identically.
 */
export function compactState(state: StoredProviderState): StoredProviderState {
  const threads = [...state.threads]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_THREADS);
  const activity = [...state.activity]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_ACTIVITY);

  const referenced = new Set<string>();
  for (const thread of threads) {
    for (const message of thread.messages) {
      if (message.role !== "agent") continue;
      for (const block of message.blocks) collectProposalId(block, referenced);
    }
  }

  const schedules = [...(state.schedules ?? [])]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_SCHEDULES);

  const proposals: Record<string, ActionProposal> = {};
  for (const id of referenced) {
    const proposal = state.proposals[id];
    if (proposal) proposals[id] = proposal;
  }
  // Never GC actionable proposals: a pending/signing card must survive even if
  // its thread aged out of the retained window, or the UI 404s on sign.
  for (const [id, proposal] of Object.entries(state.proposals)) {
    if ((proposal.state === "pending" || proposal.state === "signing") && !proposals[id]) {
      proposals[id] = proposal;
    }
  }

  const removedContacts = [...new Set(
    (state.removedContacts ?? []).map((key) => key.trim().toLowerCase()).filter(Boolean),
  )].slice(0, MAX_REMOVED_CONTACTS);

  return { threads, proposals, activity, contacts: state.contacts ?? [], schedules, removedContacts };
}

function collectProposalId(block: AgentBlock, out: Set<string>) {
  if (block.type === "proposal") out.add(block.proposalId);
}

/**
 * Normalize a raw persisted state object (post-JSON, post-bigint-revive) into a
 * well-typed `StoredProviderState`, tolerating missing/garbled fields.
 */
export function normalizeStoredState(raw: unknown): StoredProviderState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const state = raw as Partial<StoredProviderState>;
  return {
    threads: Array.isArray(state.threads) ? state.threads : [],
    proposals: isRecord(state.proposals) ? state.proposals : {},
    activity: Array.isArray(state.activity) ? state.activity : [],
    contacts: Array.isArray(state.contacts) ? state.contacts : [],
    schedules: Array.isArray(state.schedules) ? state.schedules : [],
    removedContacts: Array.isArray(state.removedContacts)
      ? state.removedContacts.filter((key): key is string => typeof key === "string")
      : [],
  };
}

function isRecord(value: unknown): value is Record<string, ActionProposal> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Encode a value for JSON, tagging bigints so money survives the round-trip. */
export function encodeBigInts(value: unknown): unknown {
  if (typeof value === "bigint") return { __praxisBigInt: value.toString() };
  if (Array.isArray(value)) return value.map(encodeBigInts);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, encodeBigInts(item)]),
    );
  }
  return value;
}

/** Revive a JSON value, turning tagged bigints back into `bigint`. */
export function reviveBigInts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reviveBigInts);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.__praxisBigInt === "string" && /^-?\d+$/.test(record.__praxisBigInt)) {
      return BigInt(record.__praxisBigInt);
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [key, reviveBigInts(item)]),
    );
  }
  return value;
}

/** Sanitize an owner wallet key into a filesystem/identifier-safe token. */
export function safeOwnerKey(ownerKey: string): string {
  return ownerKey.replace(/[^a-zA-Z0-9_-]/g, "_");
}
