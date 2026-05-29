"use client";

/**
 * The money-shot. A plain-language rendering of the Aegis verdict for a
 * proposed action — allowed (with the live daily-limit headroom) or rejected
 * (with the on-chain reason). Rejections are styled as first-class as successes:
 * a rejected, on-chain-reasoned action is the whole pitch.
 */

import type { ActionProposal } from "@praxis/shared";
import { REJECT_REASON_LABEL } from "@praxis/shared";
import { IconShieldCheck, IconShieldX } from "@tabler/icons-react";

import { formatSol, percentOf } from "./lib/units";

export function PolicyCheckBanner({ proposal }: { proposal: ActionProposal }) {
  const { check, detail } = proposal;
  const allowed = check.allowed;

  const accent = allowed ? "var(--success)" : "var(--danger)";
  const tint = allowed ? "rgba(127, 176, 105, 0.09)" : "rgba(199, 91, 91, 0.10)";
  const border = allowed ? "rgba(127, 176, 105, 0.28)" : "rgba(199, 91, 91, 0.32)";

  return (
    <div
      className="mt-[18px] rounded-xl px-[18px] py-4"
      style={{ background: tint, border: `0.5px solid ${border}` }}
      role="status"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full"
            style={{ background: allowed ? "rgba(127,176,105,0.16)" : "rgba(199,91,91,0.18)", color: accent }}
          >
            {allowed ? <IconShieldCheck size={16} /> : <IconShieldX size={16} />}
          </span>
          <div className="text-[14px] font-medium text-[var(--text-primary)]">
            {allowed ? "Within your Aegis policy" : "Blocked by Aegis"}
          </div>
        </div>
        <span
          className="[font-family:var(--font-mono)] text-[10px] tracking-[0.14em] uppercase"
          style={{ color: accent }}
        >
          {allowed ? "Allowed" : "Rejected"}
        </span>
      </div>

      {/* Reason / headroom line */}
      <p className="mt-2.5 pl-[38px] text-[13px] leading-[1.55] text-[var(--text-secondary)]">
        {allowed ? <AllowedSummary proposal={proposal} /> : check.reason}
      </p>

      {/* Daily-limit meter — shown for transfers (the SOL-cap accounting) */}
      {detail.kind === "transfer" && (
        <div className="mt-3.5 pl-[38px]">
          <DailyMeter
            spent={check.spentToday}
            amount={detail.amount}
            daily={check.dailyLimit}
            allowed={allowed}
          />
        </div>
      )}

      {/* On-chain reason code, when this maps to a real Aegis RejectReason */}
      {!allowed && check.reasonCode !== undefined && (
        <div className="mt-3 pl-[38px] [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
          on-chain reason · {REJECT_REASON_LABEL[check.reasonCode]}
        </div>
      )}
    </div>
  );
}

function AllowedSummary({ proposal }: { proposal: ActionProposal }) {
  const { check, detail } = proposal;
  if (detail.kind === "transfer") {
    const after = check.remaining - detail.amount;
    return (
      <>
        {formatSol(check.dailyLimit)} SOL daily cap · {formatSol(check.remaining)} SOL left today
        {after >= 0n && (
          <>
            {" "}
            — <span className="text-[var(--text-primary)]">{formatSol(after)} SOL</span> after this send
          </>
        )}
        .
      </>
    );
  }
  return (
    <>
      Verified mint, in your allow-list, and routed through an allowed program (Jupiter). The agent may sign it.
    </>
  );
}

function DailyMeter({
  spent,
  amount,
  daily,
  allowed,
}: {
  spent: bigint;
  amount: bigint;
  daily: bigint;
  allowed: boolean;
}) {
  const spentPct = percentOf(spent, daily);
  const txPct = percentOf(amount, daily);
  const txInBand = Math.min(txPct, Math.max(0, 100 - spentPct));
  const overflow = spentPct + txPct > 100;
  const txColor = allowed ? "var(--success)" : "var(--danger)";

  return (
    <div>
      <div className="relative h-[7px] overflow-hidden rounded-full bg-[var(--bg-elevated)]">
        {/* already spent today */}
        <div
          className="absolute inset-y-0 left-0 bg-[var(--text-quaternary)]"
          style={{ width: `${spentPct}%` }}
        />
        {/* this proposed action */}
        <div
          className="absolute inset-y-0"
          style={{ left: `${spentPct}%`, width: `${txInBand}%`, background: txColor }}
        />
        {overflow && (
          <div className="absolute inset-y-0 right-0 w-[3px] bg-[var(--danger)]" />
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
        <span>{formatSol(spent)} spent today</span>
        <span>{formatSol(daily)} SOL cap</span>
      </div>
    </div>
  );
}
