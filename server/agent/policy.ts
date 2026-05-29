import {
  DAY_WINDOW_SECONDS,
  RejectReason,
  REJECT_REASON_LABEL,
  remaining,
  type PolicyCheckResult,
  type PolicyView,
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
