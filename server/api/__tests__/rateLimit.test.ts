import { describe, expect, test } from "bun:test";

import { assertRateLimit } from "../rateLimit";
import { makeRequest } from "../../testing/fixtures";

const URL = "https://praxis.test/api/praxis/send";

describe("assertRateLimit", () => {
  test("allows up to the limit then rejects", () => {
    const ip = `1.2.3.${Math.floor(Math.random() * 250)}`;
    const opts = { scope: `scope-${Math.random()}`, limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) {
      expect(() => assertRateLimit(makeRequest(URL, { ip }), opts)).not.toThrow();
    }
    expect(() => assertRateLimit(makeRequest(URL, { ip }), opts)).toThrow(/Too many Praxis requests/);
  });

  test("separates buckets by identity", () => {
    const opts = { scope: `scope-${Math.random()}`, limit: 1, windowMs: 60_000 };
    expect(() => assertRateLimit(makeRequest(URL, { ip: "10.0.0.1" }), opts)).not.toThrow();
    // A different identity has its own fresh bucket.
    expect(() => assertRateLimit(makeRequest(URL, { ip: "10.0.0.2" }), opts)).not.toThrow();
    // The first identity is now over its limit.
    expect(() => assertRateLimit(makeRequest(URL, { ip: "10.0.0.1" }), opts)).toThrow();
  });

  test("an explicit identity overrides the IP", () => {
    const opts = { scope: `scope-${Math.random()}`, identity: "wallet-x", limit: 1, windowMs: 60_000 };
    expect(() => assertRateLimit(makeRequest(URL, { ip: "9.9.9.9" }), opts)).not.toThrow();
    expect(() => assertRateLimit(makeRequest(URL, { ip: "8.8.8.8" }), opts)).toThrow();
  });

  test("the window resets after it elapses", async () => {
    const ip = "7.7.7.7";
    const opts = { scope: `scope-${Math.random()}`, limit: 1, windowMs: 40 };
    expect(() => assertRateLimit(makeRequest(URL, { ip }), opts)).not.toThrow();
    expect(() => assertRateLimit(makeRequest(URL, { ip }), opts)).toThrow();
    await Bun.sleep(60);
    expect(() => assertRateLimit(makeRequest(URL, { ip }), opts)).not.toThrow();
  });
});
