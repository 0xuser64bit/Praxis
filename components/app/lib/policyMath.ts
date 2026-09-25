import { DAY_WINDOW_SECONDS, type PolicyView } from "@praxis/shared";

import { KNOWN_PROGRAMS } from "./tokenCatalog";

export type AgentState = "live" | "expired" | "paused" | "revoked";

export function getAgentState(policy: PolicyView, now: number): AgentState {
  if (policy.agentAuthority === KNOWN_PROGRAMS.system) return "revoked";
  if (policy.expiryTs <= now) return "expired";
  if (policy.paused) return "paused";
  return "live";
}

export function expiryAfterSevenDays(expiryTs: number, now: number): number {
  return Math.max(expiryTs, now) + 7 * 86400;
}

export function effectiveSpentToday(policy: PolicyView, now: number): bigint {
  return now >= policy.dayStartTs + DAY_WINDOW_SECONDS ? 0n : policy.spentToday;
}

export function effectiveTokenSpentToday(policy: PolicyView, now: number): bigint {
  return now >= policy.tokenDayStartTs + DAY_WINDOW_SECONDS ? 0n : policy.tokenSpentToday;
}
