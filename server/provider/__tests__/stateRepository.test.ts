import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ActivityEntry, Thread } from "@praxis/shared";

import { FsStateRepository, getStateRepository, resetStateRepositoryForTests } from "../stateRepository";
import { PostgresStateRepository, type SqlExecutor } from "../postgresStateRepository";
import { compactState, STORE_VERSION, type StoredProviderState } from "../stateSerialization";
import { randomAddress } from "../../testing/fixtures";

function activity(over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: `a-${Math.random()}`,
    kind: "transfer",
    label: "Maya",
    asset: "SOL",
    amount: 500_000_000n,
    decimals: 9,
    result: "allowed",
    ts: 1000,
    ...over,
  };
}

const emptyState = (over: Partial<StoredProviderState> = {}): StoredProviderState => ({
  threads: [],
  proposals: {},
  activity: [],
  contacts: [],
  ...over,
});

/** In-memory stand-in for `neon(url)` backed by a Map. */
function fakeSql() {
  const store = new Map<string, { version: number; state: unknown }>();
  const ddl: string[] = [];
  const sql: SqlExecutor = async (strings, ...params) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    if (/CREATE TABLE/i.test(text)) {
      ddl.push(text);
      return [];
    }
    if (/^SELECT/i.test(text)) {
      const row = store.get(params[0] as string);
      return row ? [{ state: row.state, version: row.version }] : [];
    }
    if (/^INSERT/i.test(text)) {
      const [ownerKey, version, document] = params as [string, number, string];
      store.set(ownerKey, { version, state: JSON.parse(document) });
      return [];
    }
    return [];
  };
  return { sql, store, ddl };
}

describe("FsStateRepository", () => {
  let dir: string;
  let prev: string | undefined;
  beforeAll(() => {
    prev = process.env.PRAXIS_STATE_DIR;
    dir = mkdtempSync(join(tmpdir(), "praxis-repo-"));
    process.env.PRAXIS_STATE_DIR = dir;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.PRAXIS_STATE_DIR;
    else process.env.PRAXIS_STATE_DIR = prev;
  });

  test("round-trips state through the async interface", async () => {
    const repo = new FsStateRepository();
    const owner = randomAddress();
    await repo.save(owner, emptyState({ activity: [activity({ amount: 7n })] }));
    const loaded = await repo.load(owner);
    expect(loaded?.activity[0].amount).toBe(7n);
  });

  test("returns undefined for an unknown owner", async () => {
    expect(await new FsStateRepository().load(randomAddress())).toBeUndefined();
  });
});

describe("PostgresStateRepository", () => {
  test("creates the schema once across many operations", async () => {
    const { sql, ddl } = fakeSql();
    const repo = new PostgresStateRepository(sql, compactState);
    const owner = randomAddress();
    await repo.save(owner, emptyState());
    await repo.load(owner);
    await repo.save(owner, emptyState());
    expect(ddl).toHaveLength(1);
  });

  test("round-trips state and preserves bigint money as integer strings", async () => {
    const { sql, store } = fakeSql();
    const repo = new PostgresStateRepository(sql, compactState);
    const owner = randomAddress();
    await repo.save(owner, emptyState({ activity: [activity({ amount: 123_456_789n })] }));

    // Stored JSONB tags the bigint — never a float.
    const stored = JSON.stringify(store.get(owner)?.state);
    expect(stored).toContain("__praxisBigInt");
    expect(stored).toContain("123456789");

    const loaded = await repo.load(owner);
    expect(loaded?.activity[0].amount).toBe(123_456_789n);
    expect(typeof loaded?.activity[0].amount).toBe("bigint");
  });

  test("compacts to the newest 50 threads before persisting", async () => {
    const { sql } = fakeSql();
    const repo = new PostgresStateRepository(sql, compactState);
    const owner = randomAddress();
    const threads: Thread[] = Array.from({ length: 60 }, (_, i) => ({
      id: `t-${i}`,
      title: `T${i}`,
      messages: [],
      updatedAt: i,
    }));
    await repo.save(owner, emptyState({ threads }));
    const loaded = await repo.load(owner);
    expect(loaded?.threads).toHaveLength(50);
    expect(loaded?.threads[0].updatedAt).toBe(59);
  });

  test("ignores a row written under a different store version", async () => {
    const { sql, store } = fakeSql();
    const repo = new PostgresStateRepository(sql, compactState);
    const owner = randomAddress();
    store.set(owner, { version: STORE_VERSION + 1, state: { threads: [], proposals: {}, activity: [] } });
    expect(await repo.load(owner)).toBeUndefined();
  });

  test("retries schema creation after a transient failure", async () => {
    let attempts = 0;
    const sql: SqlExecutor = async (strings) => {
      const text = strings.join("?");
      if (/CREATE TABLE/i.test(text)) {
        attempts += 1;
        if (attempts === 1) throw new Error("transient");
        return [];
      }
      return [];
    };
    const repo = new PostgresStateRepository(sql, compactState);
    await expect(repo.load("x")).rejects.toThrow(/transient/);
    await expect(repo.load("x")).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });
});

describe("getStateRepository", () => {
  const saved = {
    backend: process.env.PRAXIS_STATE_BACKEND,
    url: process.env.DATABASE_URL,
    pg: process.env.POSTGRES_URL,
    praxis: process.env.PRAXIS_DATABASE_URL,
  };
  afterEach(() => {
    process.env.PRAXIS_STATE_BACKEND = saved.backend;
    process.env.DATABASE_URL = saved.url;
    process.env.POSTGRES_URL = saved.pg;
    process.env.PRAXIS_DATABASE_URL = saved.praxis;
    for (const [k, v] of Object.entries({ PRAXIS_STATE_BACKEND: saved.backend, DATABASE_URL: saved.url, POSTGRES_URL: saved.pg, PRAXIS_DATABASE_URL: saved.praxis })) {
      if (v === undefined) delete process.env[k];
    }
    resetStateRepositoryForTests();
  });

  test("defaults to the filesystem backend with no database url", () => {
    delete process.env.PRAXIS_STATE_BACKEND;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.PRAXIS_DATABASE_URL;
    resetStateRepositoryForTests();
    expect(getStateRepository()).toBeInstanceOf(FsStateRepository);
  });

  test("throws when postgres is selected without a connection string", () => {
    process.env.PRAXIS_STATE_BACKEND = "postgres";
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.PRAXIS_DATABASE_URL;
    resetStateRepositoryForTests();
    expect(() => getStateRepository()).toThrow(/requires DATABASE_URL/);
  });

  test("rejects an unknown backend value", () => {
    process.env.PRAXIS_STATE_BACKEND = "mongo";
    resetStateRepositoryForTests();
    expect(() => getStateRepository()).toThrow(/must be "fs" or "postgres"/);
  });

  test("refuses to silently default to fs in production without a database url", () => {
    const env = process.env as Record<string, string | undefined>;
    const prevNodeEnv = env.NODE_ENV;
    delete process.env.PRAXIS_STATE_BACKEND;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.PRAXIS_DATABASE_URL;
    env.NODE_ENV = "production";
    try {
      resetStateRepositoryForTests();
      expect(() => getStateRepository()).toThrow(/No durable state backend/);

      // Explicit fs opt-in is still honored in production.
      process.env.PRAXIS_STATE_BACKEND = "fs";
      resetStateRepositoryForTests();
      expect(getStateRepository()).toBeInstanceOf(FsStateRepository);
    } finally {
      env.NODE_ENV = prevNodeEnv;
    }
  });
});
