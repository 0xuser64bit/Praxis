import { afterEach, describe, expect, test } from "bun:test";

import {
  MemoryRateLimiter,
  RedisRateLimiter,
  RespRateLimiter,
  createRespRateLimiter,
  getRateLimiter,
  resetRateLimiterForTests,
  type RespCommands,
} from "../rateLimiter";

describe("MemoryRateLimiter", () => {
  test("allows up to the limit, then denies, then resets", async () => {
    const limiter = new MemoryRateLimiter();
    expect((await limiter.hit("k", 2, 50)).allowed).toBe(true);
    expect((await limiter.hit("k", 2, 50)).allowed).toBe(true);
    const denied = await limiter.hit("k", 2, 50);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    await Bun.sleep(70);
    expect((await limiter.hit("k", 2, 50)).allowed).toBe(true);
  });

  test("tracks distinct keys independently", async () => {
    const limiter = new MemoryRateLimiter();
    expect((await limiter.hit("a", 1, 1000)).allowed).toBe(true);
    expect((await limiter.hit("b", 1, 1000)).allowed).toBe(true);
    expect((await limiter.hit("a", 1, 1000)).allowed).toBe(false);
  });
});

describe("RedisRateLimiter", () => {
  function fakeFetch(handler: (body: unknown) => { status?: number; json: unknown }) {
    const calls: unknown[] = [];
    const impl = (async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push(body);
      const { status = 200, json } = handler(body);
      return { ok: status >= 200 && status < 300, status, json: async () => json } as unknown as Response;
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  test("allows while INCR stays within the limit and pipelines EXPIRE NX", async () => {
    let count = 0;
    const { impl, calls } = fakeFetch(() => ({ json: [{ result: ++count }, { result: 1 }] }));
    const limiter = new RedisRateLimiter("https://redis.example", "token", impl);
    expect((await limiter.hit("k", 2, 60_000)).allowed).toBe(true);
    expect((await limiter.hit("k", 2, 60_000)).allowed).toBe(true);
    expect((await limiter.hit("k", 2, 60_000)).allowed).toBe(false);
    // Verifies it sends an INCR + EXPIRE NX pipeline.
    expect(JSON.stringify(calls[0])).toContain("INCR");
    expect(JSON.stringify(calls[0])).toContain("EXPIRE");
    expect(JSON.stringify(calls[0])).toContain("NX");
  });

  test("fails open when the limiter is unavailable", async () => {
    const { impl } = fakeFetch(() => ({ status: 500, json: {} }));
    const limiter = new RedisRateLimiter("https://redis.example", "token", impl);
    expect((await limiter.hit("k", 1, 1000)).allowed).toBe(true);
  });

  test("fails open when the request throws", async () => {
    const impl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const limiter = new RedisRateLimiter("https://redis.example", "token", impl);
    expect((await limiter.hit("k", 1, 1000)).allowed).toBe(true);
  });
});

describe("getRateLimiter selection", () => {
  const ENV = ["PRAXIS_RATE_LIMITER", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN", "REDIS_URL"];
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV) saved[k] = process.env[k];

  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetRateLimiterForTests();
  });

  test("defaults to memory with no redis credentials", () => {
    for (const k of ENV) delete process.env[k];
    resetRateLimiterForTests();
    expect(getRateLimiter()).toBeInstanceOf(MemoryRateLimiter);
  });

  test("uses Redis when credentials are present", () => {
    for (const k of ENV) delete process.env[k];
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    resetRateLimiterForTests();
    expect(getRateLimiter()).toBeInstanceOf(RedisRateLimiter);
  });

  test("explicit memory mode ignores credentials", () => {
    process.env.PRAXIS_RATE_LIMITER = "memory";
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    resetRateLimiterForTests();
    expect(getRateLimiter()).toBeInstanceOf(MemoryRateLimiter);
  });

  test("explicit native URL wins over REST credentials", () => {
    for (const k of ENV) delete process.env[k];
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    process.env.REDIS_URL = "redis://localhost:6379";
    resetRateLimiterForTests();
    expect(getRateLimiter()).toBeInstanceOf(RespRateLimiter);
  });
});

describe("RespRateLimiter (native RESP)", () => {
  function fakeCmds(): RespCommands & { calls: string[]; counts: Map<string, number> } {
    const counts = new Map<string, number>();
    const calls: string[] = [];
    return {
      counts,
      calls,
      incr: async (key: string) => {
        calls.push(`INCR ${key}`);
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return next;
      },
      expire: async (key: string, seconds: number, mode?: "NX") => {
        calls.push(`EXPIRE ${key} ${seconds} ${mode}`);
        return 1;
      },
    };
  }

  test("allows up to the limit with the praxis key prefix, then denies", async () => {
    const cmds = fakeCmds();
    const limiter = new RespRateLimiter(cmds);
    expect((await limiter.hit("k", 2, 60_000)).allowed).toBe(true);
    expect((await limiter.hit("k", 2, 60_000)).allowed).toBe(true);
    const denied = await limiter.hit("k", 2, 60_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(cmds.calls[0]).toBe("INCR praxis:ratelimit:k");
    expect(cmds.calls[1]).toBe("EXPIRE praxis:ratelimit:k 60 NX");
  });

  test("fails open when the server throws", async () => {
    const limiter = new RespRateLimiter({
      incr: async () => {
        throw new Error("connection refused");
      },
      expire: async () => 0,
    });
    expect((await limiter.hit("k", 1, 1000)).allowed).toBe(true);
  });

  test("createRespRateLimiter accepts injected commands without connecting", async () => {
    const limiter = createRespRateLimiter("redis://localhost:6379", fakeCmds());
    expect(limiter).toBeInstanceOf(RespRateLimiter);
    expect((await limiter.hit("k", 5, 1000)).allowed).toBe(true);
  });
});
