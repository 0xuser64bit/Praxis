import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { getNonceStore, MemoryNonceStore, RedisNonceStore, resetNonceStoreForTests } from "../nonceStore";

describe("nonce store configuration", () => {
  const names = [
    "NODE_ENV", "REDIS_URL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
    "KV_REST_API_URL", "KV_REST_API_TOKEN",
  ];
  let previous: Array<string | undefined>;

  beforeEach(() => {
    previous = names.map((name) => process.env[name]);
    for (const name of names) Reflect.deleteProperty(process.env, name);
    resetNonceStoreForTests();
  });

  afterEach(() => {
    names.forEach((name, index) => {
      if (previous[index] === undefined) Reflect.deleteProperty(process.env, name);
      else Reflect.set(process.env, name, previous[index]);
    });
    resetNonceStoreForTests();
  });

  test("refuses process-local replay protection in production", () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    expect(() => getNonceStore()).toThrow(/shared Redis/);
  });

  test("refuses incomplete Redis credentials in production", () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    expect(() => getNonceStore()).toThrow(/shared Redis/);
  });

  test("uses configured shared replay protection in production", () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    expect(getNonceStore()).toBeInstanceOf(RedisNonceStore);
  });

  test("keeps process-local nonces available in development", () => {
    Reflect.set(process.env, "NODE_ENV", "development");
    expect(getNonceStore()).toBeInstanceOf(MemoryNonceStore);
  });

  test("a process-local nonce claim cannot protect another instance", async () => {
    const firstInstance = new MemoryNonceStore();
    const secondInstance = new MemoryNonceStore();
    expect(await firstInstance.consume("captured-signed-challenge", 300)).toBe(true);
    expect(await secondInstance.consume("captured-signed-challenge", 300)).toBe(true);
  });
});

describe("RedisNonceStore", () => {
  function fakeFetch(handler: (url: string, body: unknown) => { status?: number; json: unknown }) {
    const calls: Array<{ url: string; body: unknown }> = [];
    const impl = (async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, body });
      const { status = 200, json } = handler(url, body);
      return { ok: status >= 200 && status < 300, status, json: async () => json } as unknown as Response;
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  test("claims via /pipeline SET NX EX: first consume wins, replay loses", async () => {
    const seen = new Set<string>();
    const { impl, calls } = fakeFetch((_url, body) => {
      const [cmd, key, value, ...opts] = (body as unknown[][])[0] as string[];
      expect(cmd).toBe("SET");
      expect(value).toBe("1");
      expect(opts).toEqual(["NX", "EX", "300"]);
      if (seen.has(key)) return { json: [{ result: null }] };
      seen.add(key);
      return { json: [{ result: "OK" }] };
    });
    const store = new RedisNonceStore("https://redis.example", "token", impl);
    expect(await store.consume("n1", 300)).toBe(true);
    expect(await store.consume("n1", 300)).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://redis.example/pipeline");
  });

  test("throws when the store answers non-2xx (caller fails closed)", async () => {
    const { impl } = fakeFetch(() => ({ status: 400, json: { error: "ERR syntax error" } }));
    const store = new RedisNonceStore("https://redis.example", "token", impl);
    await expect(store.consume("n1", 300)).rejects.toThrow("nonce store responded 400");
  });
});
