import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { PraxisConflictError } from "../errors";
import {
  compactState,
  encodeBigInts,
  normalizeStoredState,
  reviveBigInts,
  safeOwnerKey,
  STORE_VERSION,
  type StoredProviderState,
} from "./stateSerialization";

import type { LoadedState } from "./stateRepository";

export type { StoredProviderState } from "./stateSerialization";

interface PersistedFile {
  version: typeof STORE_VERSION;
  ownerKey: string;
  updatedAt: string;
  /** Monotonic revision for compare-and-swap writes. Absent in v0 files → 0. */
  rev?: number;
  state: StoredProviderState;
}

export function loadProviderState(ownerKey: string): LoadedState | undefined {
  const file = statePath(ownerKey);
  if (!existsSync(file)) return undefined;

  try {
    const parsed = reviveBigInts(JSON.parse(readFileSync(file, "utf8"))) as Partial<PersistedFile>;
    if (parsed.version !== STORE_VERSION || parsed.ownerKey !== ownerKey) return undefined;
    const state = normalizeStoredState(parsed.state);
    if (!state) return undefined;
    return { state, rev: readRev(parsed.rev) };
  } catch {
    return undefined;
  }
}

/**
 * Write the document if the on-disk revision is still `expectedRev`.
 *
 * The read-then-rename is not atomic against another *process* on the same
 * host, which the filesystem backend does not claim to support anyway (see
 * FsStateRepository). It is enough to catch a stale in-process writer and to
 * keep the revision contract identical across backends.
 */
export function saveProviderState(
  ownerKey: string,
  state: StoredProviderState,
  expectedRev: number,
): number {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });

  const currentRev = loadProviderState(ownerKey)?.rev ?? 0;
  if (currentRev !== expectedRev) {
    throw new PraxisConflictError(
      `Praxis state for ${ownerKey} moved from rev ${expectedRev} to ${currentRev}.`,
    );
  }

  const nextRev = currentRev + 1;
  const payload: PersistedFile = {
    version: STORE_VERSION,
    ownerKey,
    updatedAt: new Date().toISOString(),
    rev: nextRev,
    state: compactState(state),
  };

  const file = statePath(ownerKey);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(encodeBigInts(payload), null, 2));
  renameSync(tmp, file);
  return nextRev;
}

function readRev(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
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
