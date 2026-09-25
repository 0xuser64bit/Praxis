"use client";

import { useEffect, useRef, type ReactNode } from "react";

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
      className={`shrink-0 rounded-full ${pulse ? "motion-safe:[animation:pulse_2s_infinite]" : ""}`}
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

/**
 * A native modal `<dialog>`, the one place modal behaviour lives: focus is
 * trapped while open, Escape and a backdrop click dismiss it, the page behind
 * stops scrolling, and focus returns to whatever opened it.
 */
export function Modal({
  onDismiss,
  busy = false,
  labelledBy,
  describedBy,
  children,
}: {
  onDismiss: () => void;
  /** Blocks dismissal, e.g. while a wallet prompt is waiting on this dialog. */
  busy?: boolean;
  labelledBy: string;
  describedBy: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog?.open) dialog.close();
      // Keyboard focus otherwise drops to <body> after the dialog closes.
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[440px] overflow-y-auto overscroll-contain rounded-2xl bg-[var(--bg-card)] p-0 [border:0.5px_solid_var(--border-strong)] [box-shadow:0_40px_100px_-30px_rgba(0,0,0,0.8)] backdrop:bg-[rgba(0,0,0,0.6)] backdrop:backdrop-blur-[2px] motion-safe:[animation:fadeUp_0.2s_ease]"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onDismiss();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onDismiss();
      }}
      aria-modal="true"
      aria-busy={busy}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      <div className="p-6">{children}</div>
    </dialog>
  );
}
