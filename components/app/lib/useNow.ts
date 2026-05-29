"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Current unix-seconds clock that refreshes on an interval, so relative times
 * ("6h ago", "in 7d") stay fresh without calling `Date.now()` during render.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const noopSubscribe = () => () => {};

/**
 * False during SSR + first hydration, true once on the client. Uses
 * `useSyncExternalStore` (not an effect) so it is render-pure and
 * hydration-safe.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
