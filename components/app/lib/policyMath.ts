import { DAY_WINDOW_SECONDS, type PolicyUpdate, type PolicyView } from "@praxis/shared";

import { KNOWN_PROGRAMS } from "./tokenCatalog";

export type AgentState = "live" | "expired" | "paused" | "revoked";

export function getAgentState(policy: PolicyView, now: number): AgentState {
  if (policy.agentAuthority === KNOWN_PROGRAMS.system) return "revoked";
  // Order mirrors on-chain `agent_transfer` (paused → expiry) and the server
  // mirror in `server/agent/policy.ts`: a paused session reports paused even
  // when its expiry has also passed.
  if (policy.paused) return "paused";
  if (policy.expiryTs <= now) return "expired";
  return "live";
}

export function expiryAfterSevenDays(expiryTs: number, now: number): number {
  return Math.max(expiryTs, now) + 7 * 86400;
}

/**
 * The owner patch that makes a paused or expired session live again.
 *
 * `update_policy` refuses an expiry that has already passed, and every update
 * carries the current one. Unpausing a session that has also expired must
 * therefore restore the expiry in the same write, or the chain rejects it.
 */
export function resumePatch(policy: PolicyView, now: number): PolicyUpdate {
  return policy.expiryTs <= now
    ? { paused: false, expiryTs: expiryAfterSevenDays(policy.expiryTs, now) }
    : { paused: false };
}

export function effectiveSpentToday(policy: PolicyView, now: number): bigint {
  return now >= policy.dayStartTs + DAY_WINDOW_SECONDS ? 0n : policy.spentToday;
}

export function effectiveTokenSpentToday(policy: PolicyView, now: number): bigint {
  return now >= policy.tokenDayStartTs + DAY_WINDOW_SECONDS ? 0n : policy.tokenSpentToday;
}
