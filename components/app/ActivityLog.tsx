"use client";

/**
 * The audit trail: every agent action with its Aegis policy verdict. Allowed
 * actions are read from the durable on-chain ActionLog; rejections are
 * reconstructed for the current session (a rejected agent_transfer reverts, so
 * no record is stored on-chain — its proof lives in the failed tx's logs/event).
 * Enforcement is on-chain regardless; the rejection is styled first-class
 * because the chain saying "no" is the whole pitch. Doubles as the demo feed.
 */

import type { ActivityEntry, DcaScheduleView } from "@praxis/shared";
import {
  IconArrowUpRight,
  IconCalendarRepeat,
  IconCheck,
  IconExternalLink,
  IconRepeat,
  IconShieldX,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";

import { StockSwitcher, useActiveStock } from "./ActiveStock";
import { useActivity, useProvider, useSchedules } from "./ProviderContext";
import { Label, Surface } from "./ui";
import { explorerTxUrl } from "./lib/explorer";
import { formatUnits, shortenAddress } from "./lib/units";
import { useNow } from "./lib/useNow";

type Filter = "all" | "allowed" | "rejected";

export function ActivityLog() {
  const activity = useActivity();
  const [filter, setFilter] = useState<Filter>("all");
  const now = useNow();
  // Stocklana C05: the feed follows the active stock. Entries carry the asset
  // symbol (SPL rows resolve it from the on-chain mint), so filtering by symbol
  // is exact without a schema change.
  const { stocksEnabled, activeMint, symbolFor } = useActiveStock();
  const activeSymbol = activeMint ? symbolFor(activeMint) : null;

  const rejected = activity.filter((a) => a.result === "rejected").length;
  const shown = activity.filter(
    (a) =>
      (filter === "all" || a.result === filter) &&
      (!activeSymbol || a.asset === activeSymbol),
  );

  return (
    <Surface>
      {/* The title row owns the filter chips, so nothing below can move them.
          Counts live on their own single-line, fixed-height row: they used to
          be spliced into the description, where selecting a stock appended
          "· SYMBOL only", re-wrapped the paragraph, and shoved the entire feed
          down a line mid-click. */}
      <div className="mb-2.5 flex items-center justify-between gap-4">
        <h1 className="[font-family:var(--font-serif)] text-[34px] leading-none tracking-[-0.02em]">
          Activity
        </h1>
        <div className="flex shrink-0 gap-1 rounded-lg bg-[var(--bg-elevated)] p-1 [border:0.5px_solid_var(--border)]">
          {(["all", "allowed", "rejected"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
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

      <p className="text-[14px] text-[var(--text-secondary)]">
        Every agent action and its on-chain Aegis verdict. Allowed actions are
        recorded on-chain; rejections are shown for this session.
      </p>

      <div className="mt-2 flex h-[17px] items-center gap-2 overflow-hidden [font-family:var(--font-mono)] text-[11px] whitespace-nowrap text-[var(--text-tertiary)]">
        <span>{activity.length} actions</span>
        <span aria-hidden>·</span>
        <span>{rejected} rejected</span>
        {activeSymbol && (
          <>
            <span aria-hidden>·</span>
            <span className="text-[var(--accent)]">{activeSymbol} only</span>
          </>
        )}
      </div>

      {stocksEnabled && (
        <div className="mt-3.5">
          <StockSwitcher label="Filter activity by stock" />
        </div>
      )}

      <div className="mt-6">
        <SchedulesCard />
        <Label className="mb-3">History · newest first</Label>
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
    </Surface>
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
              <a
                href={explorerTxUrl(entry.sig)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 [transition:color_0.15s] hover:text-[var(--accent)]"
                aria-label="View transaction on Solana Explorer"
              >
                {shortenAddress(entry.sig, 4, 4)}
                <IconExternalLink size={11} />
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRelative(ts: number, now: number): string {
  const s = Math.max(0, now - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Recurring buys. Each fire emits one proposal the owner must still sign —
 * nothing moves on its own — and stopping one takes a single tap here.
 */
function SchedulesCard() {
  const schedules = useSchedules();
  const provider = useProvider();
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (schedules.length === 0) return null;

  const cancel = (id: string) => {
    setError(null);
    setBusy(id);
    void provider
      .cancelSchedule(id)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not stop this schedule."))
      .finally(() => setBusy(null));
  };

  return (
    <div className="mb-5 rounded-xl bg-[var(--bg-card)] px-4 py-3.5 [border:0.5px_solid_var(--border)]">
      <div className="mb-2.5 flex items-center gap-2">
        <IconCalendarRepeat size={14} className="text-[var(--text-tertiary)]" />
        <Label>Recurring buys · {schedules.length}</Label>
      </div>
      <div className="flex flex-col gap-2">
        {schedules.map((s) => (
          <ScheduleRow key={s.id} schedule={s} now={now} busy={busy === s.id} onCancel={() => cancel(s.id)} />
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[12px] leading-[1.5] text-[var(--danger)]">
          {error}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-[1.5] text-[var(--text-tertiary)]">
        Each fire proposes one buy for your signature — nothing moves until you sign.
      </p>
    </div>
  );
}

function ScheduleRow({
  schedule,
  now,
  busy,
  onCancel,
}: {
  schedule: DcaScheduleView;
  now: number;
  busy: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-[var(--bg)] px-3 py-2.5 [border:0.5px_solid_var(--border)]">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[var(--text-primary)]">
          {formatUnits(schedule.amount, schedule.decimals, { maxFrac: 4 })} {schedule.asset}
          <span className="font-normal text-[var(--text-tertiary)]"> · {describeCadence(schedule)}</span>
        </div>
        <div className="[font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
          for {schedule.recipientName} · next {formatNextFire(schedule.nextFireTs, now)}
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onCancel}
        aria-label={`Stop recurring buy of ${schedule.asset}`}
        className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-[11.5px] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)] [transition:color_0.15s] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? (
          <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
        ) : (
          <IconX size={12} />
        )}
        Stop
      </button>
    </div>
  );
}

function describeCadence(schedule: DcaScheduleView): string {
  const cadence = schedule.cadence;
  if (cadence.type === "daily") return "daily";
  if (cadence.type === "weekly") {
    const name = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][cadence.weekday] ?? "";
    return name ? `every ${name}` : "weekly";
  }
  return "monthly";
}

function formatNextFire(nextFireTs: number, now: number): string {
  const s = Math.max(0, Math.floor(nextFireTs / 1000) - now);
  if (s < 3600) return `in ${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h`;
  return `in ${Math.floor(s / 86400)}d`;
}
