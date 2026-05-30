import {
  DAY_WINDOW_SECONDS,
  RejectReason,
  REJECT_REASON_LABEL,
  remaining,
  type PolicyCheckResult,
  type PolicyView,
  type TokenInfo,
} from "@praxis/shared";

import { formatSol, formatUnits } from "../units";

const DEFAULT_MINT = "11111111111111111111111111111111";

export function effectiveSpentToday(policy: PolicyView, now: number): bigint {
  return now >= policy.dayStartTs + DAY_WINDOW_SECONDS ? 0n : policy.spentToday;
}

export function effectiveTokenSpentToday(policy: PolicyView, now: number): bigint {
  return now >= policy.tokenDayStartTs + DAY_WINDOW_SECONDS ? 0n : policy.tokenSpentToday;
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
 * Token-transfer policy check, mirrored from `agent_transfer_spl`: paused →
 * expiry → token configured → mint == token_mint (the on-chain mint allow-list)
 * → recipient allow-list → token per-tx → token daily (rolling). Caps are in
 * the TOKEN's base units, tracked independently of the SOL envelope.
 */
export function checkTokenTransferPolicy(
  policy: PolicyView,
  token: TokenInfo,
  amount: bigint,
  recipient: string,
  now: number,
): PolicyCheckResult {
  const spentToday = effectiveTokenSpentToday(policy, now);
  const base = {
    spentToday,
    dailyLimit: policy.tokenDailyLimit,
    remaining: remaining(policy.tokenDailyLimit, spentToday),
  };
  const fmt = (v: bigint) => formatUnits(v, token.decimals);

  if (policy.paused) {
    return { allowed: false, reason: "Aegis is paused, so the agent session key cannot move funds.", reasonCode: RejectReason.Paused, ...base };
  }
  if (now >= policy.expiryTs) {
    return { allowed: false, reason: "The Aegis agent session key has expired. Rotate it before signing agent actions.", reasonCode: RejectReason.Expired, ...base };
  }
  if (policy.tokenMint === DEFAULT_MINT) {
    return { allowed: false, reason: "SPL token transfers are not configured for this policy (no token mint set).", ...base };
  }
  if (token.mint !== policy.tokenMint) {
    return { allowed: false, reason: `${token.symbol} is not the policy's configured token mint, so Aegis will not move it.`, reasonCode: RejectReason.MintNotAllowed, ...base };
  }
  if (policy.allowedRecipients.length > 0 && !policy.allowedRecipients.includes(recipient)) {
    return {
      allowed: false,
      reason: "Aegis rejected this recipient because it is not in the policy allow-list.",
      reasonCode: RejectReason.RecipientNotAllowed,
      ...base,
    };
  }
  if (amount > policy.tokenMaxPerTx) {
    return { allowed: false, reason: `${fmt(amount)} ${token.symbol} exceeds the ${fmt(policy.tokenMaxPerTx)} ${token.symbol} per-transaction cap.`, reasonCode: RejectReason.OverPerTx, ...base };
  }
  if (spentToday + amount > policy.tokenDailyLimit) {
    return { allowed: false, reason: `${fmt(amount)} ${token.symbol} would exceed the remaining ${fmt(remaining(policy.tokenDailyLimit, spentToday))} ${token.symbol} daily envelope.`, reasonCode: RejectReason.OverDaily, ...base };
  }
  return { allowed: true, ...base };
}

export function checkTokenFromAegisReason(
  policy: PolicyView,
  token: TokenInfo,
  reasonCode: RejectReason,
  amount: bigint,
  recipient: string,
  now: number,
): PolicyCheckResult {
  const mirrored = checkTokenTransferPolicy(policy, token, amount, recipient, now);
  if (!mirrored.allowed && mirrored.reasonCode === reasonCode) return mirrored;
  const spentToday = effectiveTokenSpentToday(policy, now);
  return {
    allowed: false,
    reason: `Aegis rejected the token transfer: ${REJECT_REASON_LABEL[reasonCode]}.`,
    reasonCode,
    spentToday,
    dailyLimit: policy.tokenDailyLimit,
    remaining: remaining(policy.tokenDailyLimit, spentToday),
  };
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
