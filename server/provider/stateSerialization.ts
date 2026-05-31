import type {
  ActionProposal,
  ActivityEntry,
  AddressBookEntry,
  AgentBlock,
  Thread,
} from "@praxis/shared";

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
}

export const STORE_VERSION = 1;
export const MAX_THREADS = 50;
export const MAX_ACTIVITY = 250;

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

  const proposals: Record<string, ActionProposal> = {};
  for (const id of referenced) {
    const proposal = state.proposals[id];
    if (proposal) proposals[id] = proposal;
  }

  return { threads, proposals, activity, contacts: state.contacts ?? [] };
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
