"use client";

import type { ReactNode } from "react";

/** A small mono pill (matches the landing's balance/status chips). */
export function Pill({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-[7px] rounded-full bg-[var(--bg-elevated)] px-[11px] py-1 [font-family:var(--font-mono)] text-[12px] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)] ${className}`}
    >
      {children}
    </span>
  );
}

/** A status dot; `pulse` adds the landing's keyframe ring. */
export function Dot({
  color = "var(--success)",
  pulse = false,
  size = 6,
}: {
  color?: string;
  pulse?: boolean;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className={`shrink-0 rounded-full ${pulse ? "[animation:pulse_2s_infinite]" : ""}`}
      style={{ width: size, height: size, background: color }}
    />
  );
}

/** An elevated card surface with the hairline border used throughout. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl bg-[var(--bg-card)] [border:0.5px_solid_var(--border)] ${className}`}
    >
      {children}
    </div>
  );
}

/** A mono section label in --text-tertiary (matches Eyebrow but block-level). */
export function Label({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`[font-family:var(--font-mono)] text-[10px] tracking-[0.14em] text-[var(--text-tertiary)] uppercase ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * The scroll region every primary surface (Conversation, Policy, Activity)
 * renders into.
 *
 * Each of those views used to declare its own padding and `max-w-[…]`, which
 * is why switching tabs shifted the content column sideways. The gutter and
 * the measure are single tokens (`--app-gutter` / `--app-measure` in
 * globals.css); nothing below should set its own. `scrollbar-gutter: stable`
 * keeps the column from shifting on platforms with classic scrollbars, where
 * a short surface has no scrollbar and a long one does.
 */
export function Surface({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 flex-1 overflow-y-auto py-7 [padding-inline:var(--app-gutter)] [scrollbar-gutter:stable] ${className}`}
    >
      <div className="mx-auto w-full max-w-[var(--app-measure)]">{children}</div>
    </div>
  );
}

/**
 * A full-bleed band pinned outside the scroll region (the composer) whose
 * inner content still lines up with {@link Surface}'s column.
 */
export function SurfaceBand({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`shrink-0 [padding-inline:var(--app-gutter)] ${className}`}>
      <div className="mx-auto w-full max-w-[var(--app-measure)]">{children}</div>
    </div>
  );
}
