import type { AgentBlock, PolicyView } from "@praxis/shared";
import { formatSol } from "../units";

export type PolicyTopic = "caps" | "expiry" | "allowlist" | "pause" | "general";

const REVOKED_AGENT = "11111111111111111111111111111111";

/**
 * Render a plain-English, ACCURATE explanation of a policy from its real values.
 * Pure over (policy, now) so it is deterministic and unit-testable — the LLM only
 * classifies the question; this never invents a number.
 */
export function explainPolicy(policy: PolicyView, now: number, topic: PolicyTopic = "general"): AgentBlock[] {
  const prose = (text: string): AgentBlock => ({ type: "prose", text });

  const perTx = `${formatSol(policy.maxPerTx)} SOL per transaction`;
  const remaining = policy.dailyLimit > policy.spentToday ? policy.dailyLimit - policy.spentToday : 0n;
  const daily = `${formatSol(policy.dailyLimit)} SOL per day (${formatSol(remaining)} SOL remaining today)`;

  const expiry = describeExpiry(policy, now);
  const pause = policy.paused
    ? "Transfers are currently PAUSED — the agent cannot move funds until you unpause."
    : "Transfers are active (not paused).";
  const recipients = policy.allowedRecipients.length === 0
    ? "Any recipient is allowed (no recipient allow-list set)."
    : `${policy.allowedRecipients.length} allow-listed recipient(s) are enforced on-chain.`;

  switch (topic) {
    case "caps":
      return [prose(`Your spending caps: ${perTx}, and ${daily}. Aegis enforces both on-chain before any SOL leaves your vault.`)];
    case "expiry":
      return [prose(expiry)];
    case "pause":
      return [prose(pause)];
    case "allowlist":
      return [prose(recipients)];
    case "general":
    default:
      return [
        prose("Your Aegis policy is enforced on-chain — the agent can only act inside these limits, no matter what it's asked:"),
        prose(`• Per-transaction cap: ${perTx}.`),
        prose(`• Daily cap: ${daily}.`),
        prose(`• Session: ${expiry}`),
        prose(`• Recipients: ${recipients}`),
        prose(`• ${pause}`),
        prose("Because these run inside the program, a wrong or malicious instruction can't exceed them — that's what keeps you safe."),
      ];
  }
}

function describeExpiry(policy: PolicyView, now: number): string {
  if (policy.agentAuthority === REVOKED_AGENT) {
    return "The agent key has been revoked — no agent transfers are possible until you re-enable it.";
  }
  if (policy.expiryTs <= now) {
    return "Your agent session has EXPIRED — transfers are blocked until you refresh it.";
  }
  const secs = policy.expiryTs - now;
  const hours = Math.floor(secs / 3600);
  const rel = hours >= 1 ? `~${hours}h` : `~${Math.max(1, Math.floor(secs / 60))}m`;
  return `Your agent session is active and auto-expires in ${rel} (at unix ${policy.expiryTs}).`;
}
