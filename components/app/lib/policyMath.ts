import { DAY_WINDOW_SECONDS, type PolicyView } from "@praxis/shared";

export function effectiveSpentToday(policy: PolicyView, now: number): bigint {
  return now >= policy.dayStartTs + DAY_WINDOW_SECONDS ? 0n : policy.spentToday;
}

export function effectiveTokenSpentToday(policy: PolicyView, now: number): bigint {
  return now >= policy.tokenDayStartTs + DAY_WINDOW_SECONDS ? 0n : policy.tokenSpentToday;
}
