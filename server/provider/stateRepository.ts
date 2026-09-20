import { PraxisConfigError } from "../errors";
import { createPgExecutor, isLocalPostgresUrl } from "./pgStateExecutor";
import { PostgresStateRepository } from "./postgresStateRepository";
import { listProviderStateOwners, loadProviderState, saveProviderState } from "./stateStore";
import { compactState, type StoredProviderState } from "./stateSerialization";

/** A loaded state document plus the revision it was read at. */
export interface LoadedState {
  state: StoredProviderState;
  /** Monotonic revision of the stored document. `0` means "no document yet". */
  rev: number;
}

/**
 * The single seam for durable provider state. The UI/agent layer never touches
 * a storage backend directly — it goes through {@link PraxisServerProvider},
 * which loads and persists through this repository. Swapping filesystem state
 * for a managed database is an env switch (`PRAXIS_STATE_BACKEND`), not a
 * code change in the provider.
 *
 * Writes are compare-and-swap. A wallet's state is one document that every
 * request rewrites whole, so a blind write silently loses whatever another
 * instance committed in between. `save` takes the revision the caller read and
 * throws {@link PraxisConflictError} if the stored document has moved on — the
 * caller reloads and re-decides. This is what makes "claim a proposal before
 * executing it" a real mutual exclusion across serverless instances, not just
 * within one process.
 */
export interface StateRepository {
  /** Load a wallet's persisted state, or undefined if none exists yet. */
  load(ownerKey: string): Promise<LoadedState | undefined>;
  /**
   * Persist a wallet's state (compacted by the repository before writing) if
   * and only if the stored revision is still `expectedRev`. Returns the new
   * revision. Throws {@link PraxisConflictError} when it is not.
   */
  save(ownerKey: string, state: StoredProviderState, expectedRev: number): Promise<number>;
  /**
   * Owner keys that have stored state, newest first.
   *
   * Needed by the scheduled-buy job, which has no session and therefore no
   * wallet of its own: it has to discover which wallets to visit. Bounded by
   * `limit` so one tick can never fan out unboundedly.
   */
  listOwnerKeys(limit: number): Promise<string[]>;
}

/**
 * Filesystem-backed repository. Durable across restarts on a single host, but
 * NOT across serverless instances — use the Postgres backend for production.
 *
 * The CAS here is best-effort: concurrent writers on one host are already
 * serialized by the provider's per-owner mutex, and a single host has no
 * second writer to race with.
 */
export class FsStateRepository implements StateRepository {
  async load(ownerKey: string): Promise<LoadedState | undefined> {
    return loadProviderState(ownerKey);
  }

  async save(ownerKey: string, state: StoredProviderState, expectedRev: number): Promise<number> {
    // stateStore compacts on write; keep behavior identical for the FS path.
    return saveProviderState(ownerKey, state, expectedRev);
  }

  async listOwnerKeys(limit: number): Promise<string[]> {
    return listProviderStateOwners(limit);
  }
}

type Backend = "fs" | "postgres";

let cached: StateRepository | undefined;

function resolveBackend(): Backend {
  const raw = process.env.PRAXIS_STATE_BACKEND?.trim().toLowerCase();
  if (raw === "fs" || raw === "postgres") return raw;
  if (raw) {
    throw new PraxisConfigError(`PRAXIS_STATE_BACKEND must be "fs" or "postgres" (got "${raw}").`);
  }

  // No explicit backend chosen: prefer Postgres when a connection string exists.
  if (databaseUrl()) return "postgres";

  // Filesystem state is per-instance — on serverless it silently loses a wallet's
  // threads/activity the moment a request lands on a different instance. Refuse
  // to default into that in production; require either a managed database or an
  // explicit PRAXIS_STATE_BACKEND=fs that acknowledges single-host durability.
  if (process.env.NODE_ENV === "production") {
    throw new PraxisConfigError(
      "No durable state backend in production: set DATABASE_URL for managed Postgres, " +
        "or PRAXIS_STATE_BACKEND=fs to explicitly accept single-host filesystem state.",
    );
  }
  return "fs";
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
    // The neon() driver only speaks to Neon infrastructure; vanilla Postgres
    // (local Docker) needs node-postgres. Localhost auto-selects pg unless
    // PRAXIS_PG_DRIVER explicitly says otherwise.
    const driver = process.env.PRAXIS_PG_DRIVER?.trim().toLowerCase();
    if (driver && driver !== "pg" && driver !== "neon") {
      throw new PraxisConfigError(`PRAXIS_PG_DRIVER must be "pg" or "neon" (got "${driver}").`);
    }
    const usePg = driver === "pg" || (!driver && isLocalPostgresUrl(url));
    cached = new PostgresStateRepository(usePg ? createPgExecutor(url).sql : url, compactState);
  } else {
    cached = new FsStateRepository();
  }
  return cached;
}

export function resetStateRepositoryForTests(repository?: StateRepository) {
  cached = repository;
}
