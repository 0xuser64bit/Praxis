import { beforeEach, describe, expect, test } from "bun:test";

import { assertRateLimit } from "../rateLimit";
import { MemoryRateLimiter, resetRateLimiterForTests } from "../rateLimiter";
import { makeRequest } from "../../testing/fixtures";

const URL = "https://praxis.test/api/praxis/send";

beforeEach(() => {
  // Force the in-memory backend regardless of ambient env.
  resetRateLimiterForTests(new MemoryRateLimiter());
});

describe("assertRateLimit", () => {
  test("allows up to the limit then rejects", async () => {
    const ip = `1.2.3.${Math.floor(Math.random() * 250)}`;
    const opts = { scope: `scope-${Math.random()}`, limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) {
      await assertRateLimit(makeRequest(URL, { ip }), opts);
    }
    await expect(assertRateLimit(makeRequest(URL, { ip }), opts)).rejects.toThrow(/Too many Praxis requests/);
  });

  test("separates buckets by identity", async () => {
    const opts = { scope: `scope-${Math.random()}`, limit: 1, windowMs: 60_000 };
    await assertRateLimit(makeRequest(URL, { ip: "10.0.0.1" }), opts);
    await assertRateLimit(makeRequest(URL, { ip: "10.0.0.2" }), opts);
    await expect(assertRateLimit(makeRequest(URL, { ip: "10.0.0.1" }), opts)).rejects.toThrow();
  });

  test("an explicit identity overrides the IP", async () => {
    const opts = { scope: `scope-${Math.random()}`, identity: "wallet-x", limit: 1, windowMs: 60_000 };
    await assertRateLimit(makeRequest(URL, { ip: "9.9.9.9" }), opts);
    await expect(assertRateLimit(makeRequest(URL, { ip: "8.8.8.8" }), opts)).rejects.toThrow();
  });

  test("the window resets after it elapses", async () => {
    const ip = "7.7.7.7";
    const opts = { scope: `scope-${Math.random()}`, limit: 1, windowMs: 40 };
    await assertRateLimit(makeRequest(URL, { ip }), opts);
    await expect(assertRateLimit(makeRequest(URL, { ip }), opts)).rejects.toThrow();
    await Bun.sleep(60);
    await assertRateLimit(makeRequest(URL, { ip }), opts);
  });
});
