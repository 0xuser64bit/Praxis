import { describe, expect, test } from "bun:test";

import { RedisNonceStore } from "../nonceStore";

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
