import { describe, expect, test } from "bun:test";
import type { PolicyView } from "@praxis/shared";

import { expiryAfterSevenDays, getAgentState, resumePatch } from "../lib/policyMath";

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

  test("paused outranks expired, matching on-chain check order", () => {
    expect(getAgentState(policy({ paused: true, expiryTs: NOW - 1 }), NOW)).toBe("paused");
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

describe("resumePatch", () => {
  test("unpauses a session that has not expired without touching its expiry", () => {
    expect(resumePatch(policy({ paused: true }), NOW)).toEqual({ paused: false });
  });

  // update_policy requires a future expiry, so unpausing alone would be rejected on-chain.
  test("restores the expiry of a paused session that has also expired", () => {
    expect(resumePatch(policy({ paused: true, expiryTs: NOW - 1 }), NOW)).toEqual({
      paused: false,
      expiryTs: NOW + 7 * 86_400,
    });
  });
});
