import { describe, expect, test } from "bun:test";
import type { PolicyView } from "@praxis/shared";

import { expiryAfterSevenDays, getAgentState } from "../lib/policyMath";

const NOW = 1_000_000;
const ACTIVE_KEY = "ActiveSessionKey11111111111111111111111111111";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

function policy(patch: Partial<PolicyView> = {}): PolicyView {
  return {
    address: "PolicyAddress11111111111111111111111111111111",
    owner: "OwnerAddress111111111111111111111111111111111",
    agentAuthority: ACTIVE_KEY,
    maxPerTx: 1n,
    dailyLimit: 2n,
    spentToday: 0n,
    dayStartTs: NOW,
    allowedPrograms: [],
    allowedRecipients: [],
    allowedMints: [],
    expiryTs: NOW + 86_400,
    paused: false,
    vaultBalance: 0n,
    tokenMint: SYSTEM_PROGRAM,
    tokenMaxPerTx: 0n,
    tokenDailyLimit: 0n,
    tokenSpentToday: 0n,
    tokenDayStartTs: NOW,
    ...patch,
  };
}

describe("getAgentState", () => {
  test("distinguishes live, paused, expired, and revoked sessions", () => {
    expect(getAgentState(policy(), NOW)).toBe("live");
    expect(getAgentState(policy({ paused: true }), NOW)).toBe("paused");
    expect(getAgentState(policy({ expiryTs: NOW }), NOW)).toBe("expired");
    expect(
      getAgentState(
        policy({ agentAuthority: SYSTEM_PROGRAM, expiryTs: NOW - 1, paused: true }),
        NOW,
      ),
    ).toBe("revoked");
  });
});

describe("expiryAfterSevenDays", () => {
  test("never shortens a session with more than seven days remaining", () => {
    const expiryTs = NOW + 30 * 86_400;
    expect(expiryAfterSevenDays(expiryTs, NOW)).toBe(expiryTs + 7 * 86_400);
  });

  test("restores an expired session for seven days", () => {
    expect(expiryAfterSevenDays(NOW - 1, NOW)).toBe(NOW + 7 * 86_400);
  });
});
