"use client";

import { useEffect, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * The working indicator shown between a sent line and the
 * agent's reply — a pixel grid with a comet lapping its
 * perimeter, a shimmering label, and a live elapsed timer
 * in mono tabular figures.
 *
 * The centre cell never lights; the eight around it fire in
 * clockwise order, staggered 110ms across a 950ms lap, so
 * the head is always chased by a short tail.
 * ───────────────────────────────────────────────────────── */

/** Perimeter cells, clockwise from the top-left of the 3×3. */
const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const STEP_MS = 110;

/** Lap position of each cell, or null for the centre, which stays dark. */
const ORBIT = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * STEP_MS;
});

/** Past this, "thinking" has stopped being an honest description of the wait. */
const STILL_WORKING_AFTER_S = 12;

/**
 * Framed like an agent message — same mono byline, same left edge, same bottom
 * margin — so the reply resolves in place instead of the column jumping when
 * it lands.
 *
 * The timer is the honest half: a send is an LLM intent parse plus an Aegis
 * simulation plus (on a stock buy) a third-party price lookup, so multi-second
 * waits are normal and a looping animation looks identical at one second and
 * at forty. Past twelve seconds the label stops claiming to be "thinking" and
 * says the thing that is still true. It never narrates a stage — one HTTP
 * round-trip tells the client nothing about which step is running, and
 * invented progress is worse than none.
 */
export function Thinking() {
  const elapsed = useElapsed();
  const label = labelFor(elapsed);

  return (
    <div className="mb-7" role="status">
      {/* The only part read aloud. Everything below is decoration, and a live
          region that re-announced a timer ten times a second would be
          unusable — so the announcement changes once, not six hundred times. */}
      <span className="sr-only">Praxis is {label}</span>

      <div
        aria-hidden
        className="mb-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]"
      >
        Praxis
      </div>
      <div aria-hidden className="flex w-fit items-center gap-2.5">
        <span className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
          {ORBIT.map((delay, index) => (
            <span
              key={index}
              // The delay is inline but the animation itself is not: an inline
              // shorthand would outrank the reduced-motion rule that turns it
              // off, and no media query can beat a style attribute.
              className="thinking-cell size-[4px] rounded-[1px] bg-[var(--accent)]"
              data-idle={delay === null ? "" : undefined}
              style={delay === null ? undefined : { animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
        <span className="thinking-label [font-family:var(--font-mono)] text-[13px] tracking-[0.02em]">
          {label}
        </span>
        <span className="[font-family:var(--font-mono)] text-[12px] text-[var(--text-quaternary)] tabular-nums">
          {formatElapsed(elapsed)}
        </span>
      </div>
    </div>
  );
}

/** Seconds since mount, to one decimal. */
function useElapsed(): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    // Measured against a start stamp rather than incremented per tick: a
    // backgrounded tab throttles intervals, and a counter would under-report
    // exactly the long wait this readout exists for.
    const start = Date.now();
    const tick = setInterval(() => setElapsed((Date.now() - start) / 1000), 100);
    return () => clearInterval(tick);
  }, []);
  return elapsed;
}

/** What the indicator says at a given wait. Exported for the threshold test. */
export const labelFor = (seconds: number): string =>
  seconds >= STILL_WORKING_AFTER_S ? "still working" : "thinking";

/**
 * Exported for the test: the minute form is where this gets a chance to lie.
 * Rounded to tenths BEFORE the branch, so the two agree — comparing the raw
 * float against 60 renders "60.0s" for one tick on anything from 59.95 up.
 */
export const formatElapsed = (seconds: number): string => {
  const tenths = Math.round(seconds * 10);
  return tenths < 600
    ? `${(tenths / 10).toFixed(1)}s`
    : `${Math.floor(tenths / 600)}m ${((tenths % 600) / 10).toFixed(1)}s`;
};
