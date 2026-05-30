import { neon } from "@neondatabase/serverless";

import {
  encodeBigInts,
  normalizeStoredState,
  reviveBigInts,
  STORE_VERSION,
  type StoredProviderState,
} from "./stateSerialization";
import type { StateRepository } from "./stateRepository";

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

  async load(ownerKey: string): Promise<StoredProviderState | undefined> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT state, version FROM praxis_provider_state
      WHERE owner_key = ${ownerKey}
    `;
    const row = rows[0];
    if (!row || Number(row.version) !== STORE_VERSION) return undefined;
    return normalizeStoredState(reviveBigInts(row.state));
  }

  async save(ownerKey: string, state: StoredProviderState): Promise<void> {
    await this.ensureSchema();
    const document = JSON.stringify(encodeBigInts(this.compact(state)));
    await this.sql`
      INSERT INTO praxis_provider_state (owner_key, version, state, updated_at)
      VALUES (${ownerKey}, ${STORE_VERSION}, ${document}::jsonb, now())
      ON CONFLICT (owner_key)
      DO UPDATE SET version = EXCLUDED.version, state = EXCLUDED.state, updated_at = now()
    `;
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.sql`
          CREATE TABLE IF NOT EXISTS praxis_provider_state (
            owner_key text PRIMARY KEY,
            version integer NOT NULL,
            state jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
          )
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
