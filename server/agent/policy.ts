import {
  DAY_WINDOW_SECONDS,
  RejectReason,
  REJECT_REASON_LABEL,
  remaining,
  type PolicyCheckResult,
  type PolicyView,
  type TokenInfo,
} from "@praxis/shared";

import { formatSol } from "../units";

export function effectiveSpentToday(policy: PolicyView, now: number): bigint {
  return now >= policy.dayStartTs + DAY_WINDOW_SECONDS ? 0n : policy.spentToday;
}

export function checkTransferPolicy(
  policy: PolicyView,
  amount: bigint,
  recipient: string,
  now: number,
): PolicyCheckResult {
  const spentToday = effectiveSpentToday(policy, now);

  if (policy.paused) {
    return rejected(
      policy,
      spentToday,
      RejectReason.Paused,
      "Aegis is paused, so the agent session key cannot move funds until the owner rotates or unpauses it.",
    );
  }

  if (now >= policy.expiryTs) {
    return rejected(
      policy,
      spentToday,
      RejectReason.Expired,
      "The Aegis agent session key has expired. Rotate the key before signing agent actions.",
    );
  }

  if (amount > policy.maxPerTx) {
    return rejected(
      policy,
      spentToday,
      RejectReason.OverPerTx,
      `${formatSol(amount)} SOL exceeds the ${formatSol(policy.maxPerTx)} SOL per-transaction cap.`,
    );
  }

  if (spentToday + amount > policy.dailyLimit) {
    return rejected(
      policy,
      spentToday,
      RejectReason.OverDaily,
      `${formatSol(amount)} SOL would exceed the remaining ${formatSol(remaining(policy.dailyLimit, spentToday))} SOL daily envelope.`,
    );
  }

  if (policy.allowedRecipients.length > 0 && !policy.allowedRecipients.includes(recipient)) {
    return rejected(
      policy,
      spentToday,
      RejectReason.RecipientNotAllowed,
      "Aegis rejected this recipient because it is not in the policy allow-list.",
    );
  }

  return {
    allowed: true,
    spentToday,
    dailyLimit: policy.dailyLimit,
    remaining: remaining(policy.dailyLimit, spentToday),
  };
}

export function checkFromAegisReason(
  policy: PolicyView,
  reasonCode: RejectReason,
  amount: bigint,
  recipient: string,
  now: number,
): PolicyCheckResult {
  const mirrored = checkTransferPolicy(policy, amount, recipient, now);
  if (!mirrored.allowed && mirrored.reasonCode === reasonCode) return mirrored;

  const spentToday = effectiveSpentToday(policy, now);
  return rejected(policy, spentToday, reasonCode, `Aegis rejected the transfer: ${REJECT_REASON_LABEL[reasonCode]}.`);
}

/**
 * Agent-layer swap allow-list check, mirrored from the mock so API mode is
 * faithful to demo §9 #3 ("the allow-list holds"). Order matches the mock:
 * paused → program (Jupiter) → mint (verified set).
 *
 * IMPORTANT (thesis): `agent_swap` is NOT on-chain yet (v2), so a swap verdict
 * is an AGENT-LAYER decision and carries NO on-chain `RejectReason`. It is the
 * honest pre-flight gate — never presented as an on-chain enforcement result.
 */
export function checkSwapPolicy(
  policy: PolicyView,
  assetOut: TokenInfo,
  jupiterProgramId: string,
  now: number,
): PolicyCheckResult {
  const spentToday = effectiveSpentToday(policy, now);
  const base = {
    spentToday,
    dailyLimit: policy.dailyLimit,
    remaining: remaining(policy.dailyLimit, spentToday),
  };

  if (policy.paused) {
    return {
      allowed: false,
      reason:
        "Aegis is paused — the agent session key has been revoked. Re-enable it from the Policy dashboard to route swaps again.",
      ...base,
    };
  }

  if (!policy.allowedPrograms.includes(jupiterProgramId)) {
    return {
      allowed: false,
      reason:
        "Jupiter is not in your allowed-program list, so Aegis will not let the agent route this swap.",
      ...base,
    };
  }

  if (!policy.allowedMints.includes(assetOut.mint)) {
    return {
      allowed: false,
      reason: `${assetOut.symbol} isn't in your verified-mint allow-list, so Aegis won't let the agent route into it. Add the mint in the Policy dashboard if you trust it.`,
      ...base,
    };
  }

  return { allowed: true, ...base };
}

function rejected(
  policy: PolicyView,
  spentToday: bigint,
  reasonCode: RejectReason,
  reason: string,
): PolicyCheckResult {
  return {
    allowed: false,
    reason,
    reasonCode,
    spentToday,
    dailyLimit: policy.dailyLimit,
    remaining: remaining(policy.dailyLimit, spentToday),
  };
}
