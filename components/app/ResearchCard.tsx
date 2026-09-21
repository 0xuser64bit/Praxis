"use client";

/**
 * Read-only research, distilled. Surfaces on-chain data and explicitly makes no
 * buy/sell/hold call (spec §12.iv) — the "no advice" badge is part of the pitch.
 */

import type { ResearchData, ResearchMetric } from "@praxis/shared";
import { IconArrowDownRight, IconArrowUpRight, IconMinus } from "@tabler/icons-react";

import { shortenAddress } from "./lib/units";

export function ResearchCard({ data }: { data: ResearchData }) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl bg-[var(--bg)] [border:0.5px_solid_var(--border-strong)]">
      <div className="flex items-center justify-between px-5 py-3.5 [border-bottom:0.5px_solid_var(--border)]">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="[font-family:var(--font-serif)] text-[20px]">{data.token}</span>
          {/* Four live mints answer to TRUMP: the ticker alone does not say
              which coin this card is about, so the project name rides along. */}
          {data.name && (
            <span className="truncate text-[12.5px] text-[var(--text-secondary)]">{data.name}</span>
          )}
          <span
            title={data.mint}
            className="shrink-0 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]"
          >
            {shortenAddress(data.mint)}
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-dim)] px-2.5 py-1 [font-family:var(--font-mono)] text-[10px] tracking-[0.08em] text-[var(--accent)] uppercase">
          Read-only
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-4 max-[760px]:grid-cols-1 sm:grid-cols-3">
        {data.metrics.map((m) => (
          <Metric key={m.label} metric={m} />
        ))}
      </div>

      <div className="flex items-start gap-2.5 bg-[var(--bg-elevated)] px-5 py-3.5 [border-top:0.5px_solid_var(--border)]">
        <span className="mt-px [font-family:var(--font-mono)] text-[10px] tracking-[0.12em] text-[var(--text-tertiary)] uppercase">
          No advice
        </span>
        <p className="flex-1 text-[12.5px] leading-[1.55] text-[var(--text-secondary)]">
          {data.summary}
        </p>
      </div>
    </div>
  );
}

function Metric({ metric }: { metric: ResearchMetric }) {
  const color =
    metric.trend === "up"
      ? "var(--success)"
      : metric.trend === "down"
        ? "var(--danger)"
        : "var(--text-tertiary)";
  const Icon =
    metric.trend === "up"
      ? IconArrowUpRight
      : metric.trend === "down"
        ? IconArrowDownRight
        : IconMinus;
  // The abbreviated figure is what you read; the exact one is what you check.
  // Both live on the same element, so a hover (or a screen reader) reaches the
  // precise value without the card having to show fourteen digits.
  const title = [metric.exact, metric.note].filter(Boolean).join(" — ") || undefined;

  return (
    <div>
      <div className="[font-family:var(--font-mono)] text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
        {metric.label}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[16px] text-[var(--text-primary)]">
        {metric.trend && <Icon size={14} style={{ color }} />}
        <span
          title={title}
          aria-label={title ? `${metric.label}: ${metric.value}. ${title}` : undefined}
          className={
            title
              ? "cursor-help decoration-[var(--border-bright)] decoration-dotted underline-offset-4 [text-decoration-line:underline]"
              : undefined
          }
        >
          {metric.value}
        </span>
      </div>
    </div>
  );
}
