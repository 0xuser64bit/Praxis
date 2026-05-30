import { PraxisConfigError } from "../errors";
import { PostgresStateRepository } from "./postgresStateRepository";
import { loadProviderState, saveProviderState } from "./stateStore";
import { compactState, type StoredProviderState } from "./stateSerialization";

/**
 * The single seam for durable provider state. The UI/agent layer never touches
 * a storage backend directly — it goes through {@link PraxisServerProvider},
 * which loads and persists through this repository. Swapping filesystem state
 * for a managed database is an env switch (`PRAXIS_STATE_BACKEND`), not a
 * code change in the provider.
 */
export interface StateRepository {
  /** Load a wallet's persisted state, or undefined if none exists yet. */
  load(ownerKey: string): Promise<StoredProviderState | undefined>;
  /** Persist a wallet's state (compacted by the repository before writing). */
  save(ownerKey: string, state: StoredProviderState): Promise<void>;
}

/**
 * Filesystem-backed repository. Durable across restarts on a single host, but
 * NOT across serverless instances — use the Postgres backend for production.
 */
export class FsStateRepository implements StateRepository {
  async load(ownerKey: string): Promise<StoredProviderState | undefined> {
    return loadProviderState(ownerKey);
  }

  async save(ownerKey: string, state: StoredProviderState): Promise<void> {
    // stateStore compacts on write; keep behavior identical for the FS path.
    saveProviderState(ownerKey, state);
  }
}

type Backend = "fs" | "postgres";

let cached: StateRepository | undefined;

function resolveBackend(): Backend {
  const raw = process.env.PRAXIS_STATE_BACKEND?.trim().toLowerCase();
  if (!raw) {
    // Default to Postgres when a connection string is present, else filesystem.
    return databaseUrl() ? "postgres" : "fs";
  }
  if (raw === "fs" || raw === "postgres") return raw;
  throw new PraxisConfigError(`PRAXIS_STATE_BACKEND must be "fs" or "postgres" (got "${raw}").`);
}

export function databaseUrl(): string | undefined {
  return (
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.PRAXIS_DATABASE_URL?.trim() ||
    undefined
  );
}

export function getStateRepository(): StateRepository {
  if (cached) return cached;
  const backend = resolveBackend();
  if (backend === "postgres") {
    const url = databaseUrl();
    if (!url) {
      throw new PraxisConfigError(
        "PRAXIS_STATE_BACKEND=postgres requires DATABASE_URL (or POSTGRES_URL / PRAXIS_DATABASE_URL).",
      );
    }
    cached = new PostgresStateRepository(url, compactState);
  } else {
    cached = new FsStateRepository();
  }
  return cached;
}

export function resetStateRepositoryForTests(repository?: StateRepository) {
  cached = repository;
}
