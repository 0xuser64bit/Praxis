import { Pool } from "pg";

import type { SqlExecutor } from "./postgresStateRepository";

/**
 * node-postgres (`pg`) executor for vanilla Postgres — i.e. the local Docker
 * database from `compose.yml`. The `neon()` driver only speaks to Neon
 * infrastructure (verified empirically: it cannot open a local TCP session),
 * so localhost URLs need this driver instead. Selection lives in
 * `stateRepository.ts` (auto: localhost → pg, else neon; explicit override via
 * `PRAXIS_PG_DRIVER=pg|neon`).
 *
 * The pool is process-lifetime (like the neon HTTP client) and is never
 * closed by the application.
 */

export function isLocalPostgresUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** Pure template → parameterized-query conversion (unit-tested without a DB). */
export function pgTemplateToQuery(
  strings: TemplateStringsArray,
  params: unknown[],
): { text: string; values: unknown[] } {
  let text = strings[0] ?? "";
  for (let i = 0; i < params.length; i++) {
    text += `$${i + 1}${strings[i + 1] ?? ""}`;
  }
  return { text, values: params };
}

export function createPgExecutor(url: string, pool?: Pool): { sql: SqlExecutor; close(): Promise<void> } {
  const owned = pool ?? new Pool({ connectionString: url, max: 5 });
  const sql: SqlExecutor = async (strings, ...params) => {
    const { text, values } = pgTemplateToQuery(strings, params);
    const result = await owned.query(text, values as unknown[]);
    return result.rows as Record<string, unknown>[];
  };
  return { sql, close: () => owned.end() };
}
