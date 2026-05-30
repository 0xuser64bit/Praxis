/**
 * The Aegis enforcement check, mirrored off-chain for simulation-first previews.
 * Order matches `agent_transfer` (spec §5): signer/paused → expiry → per-tx →
 * daily (with rolling-window reset) → recipient allow-list. This is what lets
 * the UI show the chain's verdict in plain language BEFORE anything is signed.
 */

import type { Address, PolicyCheckResult, PolicyView, TokenInfo } from "@praxis/shared";
import { DAY_WINDOW_SECONDS, RejectReason, remaining } from "@praxis/shared";

import { formatSol, formatUnits } from "../lib/units";

/** Default (zero) mint sentinel — means the token envelope is not configured. */
const DEFAULT_MINT = "11111111111111111111111111111111";

/** Effective `spent_today` after applying the rolling 24h reset. */
export function effectiveSpentToday(policy: PolicyView, now: number): bigint {
  return now >= policy.dayStartTs + DAY_WINDOW_SECONDS ? 0n : policy.spentToday;
}

/** Effective token `spent_today` after applying the token's rolling 24h reset. */
export function effectiveTokenSpentToday(policy: PolicyView, now: number): bigint {
  return now >= policy.tokenDayStartTs + DAY_WINDOW_SECONDS ? 0n : policy.tokenSpentToday;
}

function reject(
  code: RejectReason,
  reason: string,
  spentToday: bigint,
  dailyLimit: bigint,
): PolicyCheckResult {
  return {
    allowed: false,
    reason,
    reasonCode: code,
    spentToday,
    dailyLimit,
    remaining: remaining(dailyLimit, spentToday),
  };
}

/** Run the full transfer policy check for a native-SOL `agent_transfer`. */
export function checkTransfer(
  policy: PolicyView,
  amount: bigint,
  recipient: Address,
  now: number,
): PolicyCheckResult {
  const spent = effectiveSpentToday(policy, now);
  const { dailyLimit } = policy;

  // signer / revoke / pause — revoke zeroes the key AND pauses, both land here.
  if (policy.paused) {
    return reject(
      RejectReason.Paused,
      "Aegis is paused — the agent session key has been revoked. Rotate or re-enable it from the Policy dashboard before the agent can act again.",
      spent,
      dailyLimit,
    );
  }

  if (now >= policy.expiryTs) {
    return reject(
      RejectReason.Expired,
      "The agent session key has expired. Rotate it from the Policy dashboard to continue.",
      spent,
      dailyLimit,
    );
  }

  if (amount > policy.maxPerTx) {
    return reject(
      RejectReason.OverPerTx,
      `${formatSol(amount)} SOL exceeds the ${formatSol(policy.maxPerTx)} SOL per-transaction limit.`,
      spent,
      dailyLimit,
    );
  }

  if (spent + amount > dailyLimit) {
    return reject(
      RejectReason.OverDaily,
      `${formatSol(amount)} SOL would exceed today's remaining ${formatSol(remaining(dailyLimit, spent))} SOL (of a ${formatSol(dailyLimit)} SOL daily cap).`,
      spent,
      dailyLimit,
    );
  }

  if (
    policy.allowedRecipients.length > 0 &&
    !policy.allowedRecipients.includes(recipient)
  ) {
    return reject(
      RejectReason.RecipientNotAllowed,
      "This recipient isn't in your allow-list. Add them in the Policy dashboard, or send to an allow-listed address.",
      spent,
      dailyLimit,
    );
  }

  return {
    allowed: true,
    spentToday: spent,
    dailyLimit,
    remaining: remaining(dailyLimit, spent),
  };
}

/**
 * The token-transfer policy check, mirrored off-chain from `agent_transfer_spl`:
 * paused/expiry → token configured → mint == token_mint (the on-chain mint
 * allow-list) → token per-tx → token daily (rolling). Caps are in the TOKEN's
 * own base units, tracked independently of the SOL envelope.
 */
export function checkTokenTransfer(
  policy: PolicyView,
  token: TokenInfo,
  amount: bigint,
  now: number,
): PolicyCheckResult {
  const spent = effectiveTokenSpentToday(policy, now);
  const dailyLimit = policy.tokenDailyLimit;
  const fmt = (v: bigint) => formatUnits(v, token.decimals, { maxFrac: 4 });

  if (policy.paused) {
    return reject(
      RejectReason.Paused,
      "Aegis is paused — the agent session key has been revoked. Rotate or re-enable it from the Policy dashboard.",
      spent,
      dailyLimit,
    );
  }

  if (now >= policy.expiryTs) {
    return reject(
      RejectReason.Expired,
      "The agent session key has expired. Rotate it from the Policy dashboard to continue.",
      spent,
      dailyLimit,
    );
  }

  if (policy.tokenMint === DEFAULT_MINT) {
    return {
      allowed: false,
      reason:
        "SPL token transfers aren't configured for this policy. Set a token mint and its caps in the Policy dashboard first.",
      spentToday: spent,
      dailyLimit,
      remaining: remaining(dailyLimit, spent),
    };
  }

  if (token.mint !== policy.tokenMint) {
    return reject(
      RejectReason.MintNotAllowed,
      `${token.symbol} is not the policy's configured token mint, so Aegis won't let the agent move it.`,
      spent,
      dailyLimit,
    );
  }

  if (amount > policy.tokenMaxPerTx) {
    return reject(
      RejectReason.OverPerTx,
      `${fmt(amount)} ${token.symbol} exceeds the ${fmt(policy.tokenMaxPerTx)} ${token.symbol} per-transaction limit.`,
      spent,
      dailyLimit,
    );
  }

  if (spent + amount > dailyLimit) {
    return reject(
      RejectReason.OverDaily,
      `${fmt(amount)} ${token.symbol} would exceed today's remaining ${fmt(remaining(dailyLimit, spent))} ${token.symbol} (of a ${fmt(dailyLimit)} ${token.symbol} daily cap).`,
      spent,
      dailyLimit,
    );
  }

  return {
    allowed: true,
    spentToday: spent,
    dailyLimit,
    remaining: remaining(dailyLimit, spent),
  };
}
