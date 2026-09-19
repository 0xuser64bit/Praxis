import { describe, expect, test } from "bun:test";

import { isLocalPostgresUrl, pgTemplateToQuery } from "../pgStateExecutor";

describe("isLocalPostgresUrl", () => {
  test("matches loopback hosts only", () => {
    expect(isLocalPostgresUrl("postgresql://praxis:praxis@localhost:5432/praxis")).toBe(true);
    expect(isLocalPostgresUrl("postgres://user:pw@127.0.0.1/db")).toBe(true);
    expect(isLocalPostgresUrl("postgresql://user@db.internal:5432/praxis")).toBe(false);
    expect(isLocalPostgresUrl("postgresql://user@ep-xyz.neon.tech/db?sslmode=require")).toBe(false);
    expect(isLocalPostgresUrl("not a url")).toBe(false);
  });
});

describe("pgTemplateToQuery", () => {
  test("numbers placeholders sequentially and passes values through", () => {
    const t = (s: TemplateStringsArray, ...p: unknown[]) => pgTemplateToQuery(s, p);
    const q = t`SELECT state FROM praxis_provider_state WHERE owner_key = ${"abc"} AND version = ${2}`;
    expect(q.text).toBe("SELECT state FROM praxis_provider_state WHERE owner_key = $1 AND version = $2");
    expect(q.values).toEqual(["abc", 2]);
  });

  test("handles zero params and JSON document payloads", () => {
    const t = (s: TemplateStringsArray, ...p: unknown[]) => pgTemplateToQuery(s, p);
    expect(t`CREATE TABLE IF NOT EXISTS x (a text)`.text).toBe("CREATE TABLE IF NOT EXISTS x (a text)");
    const doc = JSON.stringify({ threads: [] });
    const q = t`INSERT INTO t (state) VALUES (${doc}::jsonb)`;
    expect(q.text).toBe("INSERT INTO t (state) VALUES ($1::jsonb)");
    expect(q.values).toEqual([doc]);
  });
});
