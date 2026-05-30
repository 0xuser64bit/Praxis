import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  compactState,
  encodeBigInts,
  normalizeStoredState,
  reviveBigInts,
  safeOwnerKey,
  STORE_VERSION,
  type StoredProviderState,
} from "./stateSerialization";

export type { StoredProviderState } from "./stateSerialization";

interface PersistedFile {
  version: typeof STORE_VERSION;
  ownerKey: string;
  updatedAt: string;
  state: StoredProviderState;
}

export function loadProviderState(ownerKey: string): StoredProviderState | undefined {
  const file = statePath(ownerKey);
  if (!existsSync(file)) return undefined;

  try {
    const parsed = reviveBigInts(JSON.parse(readFileSync(file, "utf8"))) as Partial<PersistedFile>;
    if (parsed.version !== STORE_VERSION || parsed.ownerKey !== ownerKey) return undefined;
    return normalizeStoredState(parsed.state);
  } catch {
    return undefined;
  }
}

export function saveProviderState(ownerKey: string, state: StoredProviderState) {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });

  const payload: PersistedFile = {
    version: STORE_VERSION,
    ownerKey,
    updatedAt: new Date().toISOString(),
    state: compactState(state),
  };

  const file = statePath(ownerKey);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(encodeBigInts(payload), null, 2));
  renameSync(tmp, file);
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
