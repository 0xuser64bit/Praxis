import { neon } from "@neondatabase/serverless";

import {
  encodeBigInts,
  normalizeStoredState,
  reviveBigInts,
  STORE_VERSION,
  type StoredProviderState,
} from "./stateSerialization";
import type { LoadedState, StateRepository } from "./stateRepository";
import { PraxisConflictError } from "../errors";

/**
 * A tagged-template SQL executor — the shape of `neon(url)`. Abstracted so the
 * adapter can be unit-tested against a fake without a live database.
 */
export type SqlExecutor = (
  strings: TemplateStringsArray,
  ...params: unknown[]
) => Promise<Record<string, unknown>[]>;

/**
 * Managed-Postgres (Neon) backend. Stores one compacted JSONB document per
 * wallet, keyed by owner address. Money survives as tagged-bigint strings in
 * JSONB (never floats). Durable across serverless instances and restarts.
 *
 * Writes are compare-and-swap on a monotonic `rev` column. Two Fluid Compute
 * instances serving the same wallet would otherwise both read a document,
 * mutate it, and write it back — the second silently erasing the first. With
 * CAS the loser is told, and (critically) a proposal can be *claimed* before
 * it is executed on-chain, so a duplicated request cannot submit the same
 * transfer twice.
 *
 * The schema is created lazily and idempotently on first use, so no separate
 * migration step is required for this single-table store; the same DDL also
 * lives in `server/provider/migrations/0001_init.sql` for managed migration
 * tooling. The table name is a compile-time constant baked into the SQL (never
 * interpolated), so there is no identifier-injection surface.
 */
export class PostgresStateRepository implements StateRepository {
  private readonly sql: SqlExecutor;
  private readonly compact: (state: StoredProviderState) => StoredProviderState;
  private schemaReady: Promise<void> | undefined;

  constructor(
    urlOrExecutor: string | SqlExecutor,
    compact: (state: StoredProviderState) => StoredProviderState,
  ) {
    this.sql =
      typeof urlOrExecutor === "string"
        ? (neon(urlOrExecutor) as unknown as SqlExecutor)
        : urlOrExecutor;
    this.compact = compact;
  }

  async load(ownerKey: string): Promise<LoadedState | undefined> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT state, version, rev FROM praxis_provider_state
      WHERE owner_key = ${ownerKey}
    `;
    const row = rows[0];
    if (!row || Number(row.version) !== STORE_VERSION) return undefined;
    const state = normalizeStoredState(reviveBigInts(row.state));
    if (!state) return undefined;
    return { state, rev: Number(row.rev ?? 0) };
  }

  async save(ownerKey: string, state: StoredProviderState, expectedRev: number): Promise<number> {
    await this.ensureSchema();
    const document = JSON.stringify(encodeBigInts(this.compact(state)));
    const nextRev = expectedRev + 1;

    // One statement, one round trip, no read-modify-write window: the insert
    // path fires only when no row exists (expectedRev 0), and the update path
    // only when the stored rev still matches. Zero rows back means someone
    // else got there first.
    const rows = await this.sql`
      INSERT INTO praxis_provider_state (owner_key, version, state, rev, updated_at)
      VALUES (${ownerKey}, ${STORE_VERSION}, ${document}::jsonb, ${nextRev}, now())
      ON CONFLICT (owner_key) DO UPDATE
        SET version = EXCLUDED.version,
            state = EXCLUDED.state,
            rev = EXCLUDED.rev,
            updated_at = now()
        WHERE praxis_provider_state.rev = ${expectedRev}
      RETURNING rev
    `;
    if (rows.length === 0) {
      throw new PraxisConflictError(
        `Praxis state for ${ownerKey} was written by another instance (expected rev ${expectedRev}).`,
      );
    }
    return Number(rows[0].rev ?? nextRev);
  }

  async listOwnerKeys(limit: number): Promise<string[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT owner_key FROM praxis_provider_state
      WHERE version = ${STORE_VERSION}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;
    return rows
      .map((row) => row.owner_key)
      .filter((key): key is string => typeof key === "string" && key.length > 0);
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.sql`
          CREATE TABLE IF NOT EXISTS praxis_provider_state (
            owner_key text PRIMARY KEY,
            version integer NOT NULL,
            state jsonb NOT NULL,
            rev bigint NOT NULL DEFAULT 0,
            updated_at timestamptz NOT NULL DEFAULT now()
          )
        `;
        // Databases created before optimistic concurrency landed predate the
        // column; existing rows start at rev 0, which is exactly what a fresh
        // reader expects.
        await this.sql`
          ALTER TABLE praxis_provider_state
          ADD COLUMN IF NOT EXISTS rev bigint NOT NULL DEFAULT 0
        `;
      })().catch((error) => {
        // Reset so a transient failure can be retried on the next call.
        this.schemaReady = undefined;
        throw error;
      });
    }
    return this.schemaReady;
  }
}
