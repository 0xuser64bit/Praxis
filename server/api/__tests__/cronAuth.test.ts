import { afterEach, describe, expect, test } from "bun:test";

import { assertCronAuthorized, cronSecretConfigured, hasBearerToken } from "../cronAuth";
import { PraxisAuthError, PraxisConfigError } from "../../errors";

const SECRET = "a-sufficiently-long-cron-secret";

function request(authorization?: string): Request {
  return new Request("https://praxis.test/api/cron/stocks", {
    headers: authorization ? { authorization } : {},
  });
}

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("cron authorization", () => {
  test("is unavailable — not open — when no secret is configured", () => {
    expect(cronSecretConfigured()).toBe(false);
    // The failure mode that matters: never "no secret, so allow everyone".
    expect(() => assertCronAuthorized(request(`Bearer ${SECRET}`))).toThrow(PraxisConfigError);
    expect(() => assertCronAuthorized(request())).toThrow(PraxisConfigError);
  });

  test("rejects a trivially short secret rather than trusting it", () => {
    process.env.CRON_SECRET = "short";
    expect(() => assertCronAuthorized(request("Bearer short"))).toThrow(PraxisConfigError);
  });

  test("accepts the configured secret", () => {
    process.env.CRON_SECRET = SECRET;
    expect(() => assertCronAuthorized(request(`Bearer ${SECRET}`))).not.toThrow();
    expect(() => assertCronAuthorized(request(`bearer ${SECRET}`))).not.toThrow();
  });

  test("rejects a missing, malformed, or wrong token", () => {
    process.env.CRON_SECRET = SECRET;
    for (const header of [
      undefined,
      "",
      SECRET, // no Bearer scheme
      "Bearer ",
      `Bearer ${SECRET}x`,
      `Bearer ${SECRET.slice(0, -1)}`,
      "Bearer wrong-secret-of-same-length-xx",
    ]) {
      expect(() => assertCronAuthorized(request(header))).toThrow(PraxisAuthError);
    }
  });

  test("hasBearerToken distinguishes the scheduler from a cookie caller", () => {
    expect(hasBearerToken(request())).toBe(false);
    expect(hasBearerToken(request("Bearer x"))).toBe(true);
    // A bearer-carrying request is never downgraded to the session path, so a
    // stale secret fails loudly instead of quietly firing nothing.
    expect(hasBearerToken(request("Bearer stale"))).toBe(true);
  });
});
