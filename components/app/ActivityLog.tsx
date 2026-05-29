"use client";

/**
 * The audit trail: every agent action with its Aegis policy verdict. Allowed
 * actions are read from the durable on-chain ActionLog; rejections are
 * reconstructed for the current session (a rejected agent_transfer reverts, so
 * no record is stored on-chain — its proof lives in the failed tx's logs/event).
 * Enforcement is on-chain regardless; the rejection is styled first-class
 * because the chain saying "no" is the whole pitch. Doubles as the demo feed.
 */

import type { ActivityEntry } from "@praxis/shared";
import {
  IconArrowUpRight,
  IconCheck,
  IconExternalLink,
  IconRepeat,
  IconShieldX,
} from "@tabler/icons-react";
import { useState } from "react";

import { useActivity } from "./ProviderContext";
import { Label } from "./ui";
import { formatUnits, shortenAddress } from "./lib/units";
import { useNow } from "./lib/useNow";

type Filter = "all" | "allowed" | "rejected";

export function ActivityLog() {
  const activity = useActivity();
  const [filter, setFilter] = useState<Filter>("all");
  const now = useNow();

  const rejected = activity.filter((a) => a.result === "rejected").length;
  const shown = activity.filter((a) => filter === "all" || a.result === filter);

  return (
    <div className="flex-1 overflow-y-auto px-8 py-7 max-[760px]:px-5">
      <div className="mx-auto max-w-[760px]">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="[font-family:var(--font-serif)] text-[34px] leading-none tracking-[-0.02em]">
              Activity
            </h1>
            <p className="mt-2.5 text-[14px] text-[var(--text-secondary)]">
              Every agent action and its on-chain Aegis verdict. Allowed actions are
              recorded on-chain; rejections are shown for this session.{" "}
              {activity.length} actions · {rejected} rejected.
            </p>
          </div>
          <div className="flex shrink-0 gap-1 rounded-lg bg-[var(--bg-elevated)] p-1 [border:0.5px_solid_var(--border)]">
            {(["all", "allowed", "rejected"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1.5 [font-family:var(--font-mono)] text-[11px] capitalize [transition:background_0.15s,color_0.15s] ${
                  filter === f
                    ? "bg-[var(--bg-card)] text-[var(--text-primary)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <Label className="mb-3">Newest first</Label>
        <div className="flex flex-col gap-2.5">
          {shown.map((entry) => (
            <ActivityRow key={entry.id} entry={entry} now={now} />
          ))}
          {shown.length === 0 && (
            <div className="rounded-xl bg-[var(--bg-card)] px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)]">
              No {filter === "all" ? "" : filter} actions yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityRow({ entry, now }: { entry: ActivityEntry; now: number }) {
  const rejected = entry.result === "rejected";
  const KindIcon = entry.kind === "swap" ? IconRepeat : IconArrowUpRight;
  const amount = `${formatUnits(entry.amount, entry.decimals, { maxFrac: 4 })} ${entry.asset}`;

  return (
    <div
      className="flex items-start gap-3.5 rounded-xl px-4 py-3.5"
      style={{
        background: rejected ? "rgba(199,91,91,0.08)" : "var(--bg-card)",
        border: `0.5px solid ${rejected ? "rgba(199,91,91,0.28)" : "var(--border)"}`,
      }}
    >
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{
          background: rejected ? "rgba(199,91,91,0.16)" : "rgba(127,176,105,0.14)",
          color: rejected ? "var(--danger)" : "var(--success)",
        }}
      >
        {rejected ? <IconShieldX size={16} /> : <IconCheck size={16} />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <KindIcon size={14} className="text-[var(--text-tertiary)]" />
          <span className="text-[14px] font-medium text-[var(--text-primary)]">{entry.label}</span>
          <span className="[font-family:var(--font-mono)] text-[12px] text-[var(--text-secondary)]">
            {amount}
          </span>
          <span
            className="ml-1 rounded-full px-2 py-0.5 [font-family:var(--font-mono)] text-[9px] tracking-[0.1em] uppercase"
            style={{
              color: rejected ? "var(--danger)" : "var(--success)",
              background: rejected ? "rgba(199,91,91,0.14)" : "rgba(127,176,105,0.12)",
            }}
          >
            {rejected ? "Rejected" : "Allowed"}
          </span>
        </div>

        {rejected && entry.reason && (
          <p className="mt-1.5 text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
            {entry.reason}
          </p>
        )}

        <div className="mt-1.5 flex items-center gap-2.5 [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
          <span>{formatRelative(entry.ts, now)}</span>
          {entry.sig && (
            <>
              <span aria-hidden>·</span>
              <span className="flex items-center gap-1">
                {shortenAddress(entry.sig, 4, 4)}
                <IconExternalLink size={11} />
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRelative(ts: number, now: number): string {
  const s = Math.max(0, now - ts);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
