import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type {
  ActionProposal,
  ActivityEntry,
  AgentBlock,
  Thread,
} from "@praxis/shared";

export interface StoredProviderState {
  threads: Thread[];
  proposals: Record<string, ActionProposal>;
  activity: ActivityEntry[];
}

interface PersistedFile {
  version: 1;
  ownerKey: string;
  updatedAt: string;
  state: StoredProviderState;
}

const MAX_THREADS = 50;
const MAX_ACTIVITY = 250;
const STORE_VERSION = 1;

export function loadProviderState(ownerKey: string): StoredProviderState | undefined {
  const file = statePath(ownerKey);
  if (!existsSync(file)) return undefined;

  try {
    const parsed = revive(JSON.parse(readFileSync(file, "utf8"))) as Partial<PersistedFile>;
    if (parsed.version !== STORE_VERSION || parsed.ownerKey !== ownerKey) return undefined;
    if (!parsed.state || typeof parsed.state !== "object") return undefined;
    return {
      threads: Array.isArray(parsed.state.threads) ? parsed.state.threads : [],
      proposals: isRecord(parsed.state.proposals) ? parsed.state.proposals : {},
      activity: Array.isArray(parsed.state.activity) ? parsed.state.activity : [],
    };
  } catch {
    return undefined;
  }
}

export function saveProviderState(ownerKey: string, state: StoredProviderState) {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });

  const compact = compactState(state);
  const payload: PersistedFile = {
    version: STORE_VERSION,
    ownerKey,
    updatedAt: new Date().toISOString(),
    state: compact,
  };

  const file = statePath(ownerKey);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(encode(payload), null, 2));
  renameSync(tmp, file);
}

function compactState(state: StoredProviderState): StoredProviderState {
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
      for (const block of message.blocks) {
        collectProposalId(block, referenced);
      }
    }
  }

  const proposals: Record<string, ActionProposal> = {};
  for (const id of referenced) {
    const proposal = state.proposals[id];
    if (proposal) proposals[id] = proposal;
  }

  return { threads, proposals, activity };
}

function collectProposalId(block: AgentBlock, out: Set<string>) {
  if (block.type === "proposal") out.add(block.proposalId);
}

function stateDir(): string {
  const configured = process.env.PRAXIS_STATE_DIR?.trim();
  if (configured) {
    return resolve(/* turbopackIgnore: true */ process.cwd(), configured);
  }
  return join(/* turbopackIgnore: true */ process.cwd(), ".praxis", "state");
}

function statePath(ownerKey: string): string {
  return join(stateDir(), `${safeOwnerKey(ownerKey)}.json`);
}

function safeOwnerKey(ownerKey: string): string {
  return ownerKey.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function encode(value: unknown): unknown {
  if (typeof value === "bigint") return { __praxisBigInt: value.toString() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  }
  return value;
}

function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.__praxisBigInt === "string" && /^-?\d+$/.test(record.__praxisBigInt)) {
      return BigInt(record.__praxisBigInt);
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, revive(item)]));
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, ActionProposal> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
