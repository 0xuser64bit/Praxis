/**
 * Local-dependency gate (docker compose): proves the app's Postgres state
 * backend and native-RESP rate limiter work against the real containers —
 * no cloud credentials, no mocks.
 *
 * Run: `docker compose up -d && bun run praxis:localcheck`
 */

import { createClient } from "redis";

import { getRateLimiter, resetRateLimiterForTests, RespRateLimiter } from "../server/api/rateLimiter";
import { createPgExecutor, isLocalPostgresUrl } from "../server/provider/pgStateExecutor";
import { PostgresStateRepository } from "../server/provider/postgresStateRepository";
import { compactState } from "../server/provider/stateSerialization";

const PG_URL = process.env.PRAXIS_LOCAL_DATABASE_URL?.trim() || "postgresql://praxis:praxis@localhost:5433/praxis";
const REDIS_URL = process.env.REDIS_URL?.trim() || "redis://localhost:6379";

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`│   ✓ ${label}${detail ? `  ↳ ${detail}` : ""}`);
  else {
    failures++;
    console.log(`│   ✗ ${label}  ↳ FAILED ${detail}`);
  }
}

async function postgresPart() {
  console.log("│ A. Postgres state backend (pg driver, lazy schema)");
  assert("URL is local (pg driver applies)", isLocalPostgresUrl(PG_URL), PG_URL.split("@")[1] ?? PG_URL);
  const { sql, close } = createPgExecutor(PG_URL);
  try {
    const repo = new PostgresStateRepository(sql, compactState);
    const before = await repo.load("localcheck-owner");
    assert("empty load → undefined (no crash on fresh DB)", before === undefined);
    // Save a minimal state document through the real serialization path.
    const rev = await repo.save("localcheck-owner", { threads: [], proposals: {}, activity: [], contacts: [] }, 0);
    const after = await repo.load("localcheck-owner");
    assert("save → load round-trips", after !== undefined);
    assert(
      "round-tripped shape intact",
      Array.isArray(after?.state.threads) && typeof after?.state.proposals === "object",
    );
    assert("revision advances on write", after?.rev === rev, `rev=${after?.rev}`);
    // A stale writer must lose: this is what stops two instances from both
    // executing the same proposal.
    let conflicted = false;
    try {
      await repo.save("localcheck-owner", { threads: [], proposals: {}, activity: [], contacts: [] }, 0);
    } catch {
      conflicted = true;
    }
    assert("stale-revision write is rejected (CAS)", conflicted);
    await sql`DELETE FROM praxis_provider_state WHERE owner_key = ${"localcheck-owner"}`;
    assert("cleanup delete works", (await repo.load("localcheck-owner")) === undefined);
  } finally {
    await close();
  }
}

async function redisPart() {
  console.log("│ B. Native-RESP rate limiter (live server)");
  const client = createClient({ url: REDIS_URL });
  client.on("error", () => {});
  await client.connect();
  try {
    await client.del("praxis:ratelimit:localcheck");
    resetRateLimiterForTests();
    process.env.REDIS_URL = REDIS_URL;
    delete process.env.PRAXIS_RATE_LIMITER;
    const limiter = getRateLimiter();
    assert("REDIS_URL selects the RESP backend", limiter instanceof RespRateLimiter);
    expect1(await limiter.hit("localcheck", 2, 60_000), true, "hit 1 allowed");
    expect1(await limiter.hit("localcheck", 2, 60_000), true, "hit 2 allowed");
    expect1(await limiter.hit("localcheck", 2, 60_000), false, "hit 3 blocked");
    await client.del("praxis:ratelimit:localcheck");
  } finally {
    await client.quit().catch(() => {});
    resetRateLimiterForTests();
  }
}

function expect1(v: { allowed: boolean }, want: boolean, label: string) {
  assert(label, v.allowed === want);
}

async function main() {
  console.log("┌──── LOCAL DEPENDENCIES (docker compose) ────────────────────────────────");
  await postgresPart();
  await redisPart();
  console.log("└───────────────────────────────────────────────────────────────────────────");
  if (failures === 0) {
    console.log("\nLOCAL DEPS: PASS ✅");
    process.exit(0);
  }
  console.log(`\nLOCAL DEPS: FAIL ❌ — ${failures} assertion(s) failed.`);
  process.exit(1);
}

void main();
