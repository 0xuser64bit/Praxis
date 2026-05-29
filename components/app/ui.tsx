"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";

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

/** A ghost icon button. */
export function IconButton({
  children,
  className = "",
  ...rest
}: ComponentPropsWithoutRef<"button">) {
  return (
    <button
      type="button"
      className={`flex cursor-pointer items-center justify-center rounded-md text-[var(--text-tertiary)] [transition:color_0.15s,background_0.15s] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A simple mono caption row. */
export function Mono({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`[font-family:var(--font-mono)] ${className}`}>{children}</span>
  );
}
