import { STOCK_SYMBOLS } from "./universe";

/**
 * Stocklana C06: mechanical DCA schedules + basket definitions. Pure module —
 * no env, no I/O — so cadence math and basket splits are unit-testable.
 *
 * Operating rules (binding for the submission branch):
 * - A schedule NEVER signs. Each fire emits one transfer proposal through the
 *   same `checkTokenTransferPolicy` path as a one-off buy; the user signs.
 * - A basket NEVER partially signs. All constituents are simulated first; if
 *   any is blocked, the whole basket becomes a clarification and nothing is
 *   stored. Amounts never move until each proposal is individually signed.
 * - Baskets contain ONLY PreStocks pre-IPO mints (bounty exclusivity).
 */

/** When a recurring buy fires. `weekday`: 0=Sunday..6=Saturday (UTC). */
export type DcaCadence =
  | { type: "daily" }
  | { type: "weekly"; weekday: number }
  | { type: "monthly"; day: number };

export interface DcaSchedule {
  id: string;
  /** Canonical asset symbol, e.g. "OPENAI". */
  asset: string;
  /** Per-fire amount in the token's base units (never float). */
  amount: bigint;
  decimals: number;
  recipientAddress: string;
  recipientName: string;
  cadence: DcaCadence;
  /** Unix milliseconds of the next fire. */
  nextFireTs: number;
  createdAt: number;
  /** Thread the schedule was created in (cron appends proposals there). */
  threadId: string;
}

const DAY_MS = 86_400_000;

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Parse cadence phrasing: "every monday", "weekly", "daily", "monthly",
 * "every day/week/month". Returns null when the text names no cadence.
 */
export function parseCadence(text: string): DcaCadence | null {
  const t = text.toLowerCase().trim();
  let m = t.match(/\bevery\s+([a-z]+)\s*$/);
  if (m) {
    const word = m[1];
    if (word === "day" || word === "daily") return { type: "daily" };
    if (word === "week" || word === "weekly") {
      // "every week" from a weekday-anchored start; weekday resolved at creation.
      return { type: "weekly", weekday: new Date().getUTCDay() };
    }
    if (word === "month" || word === "monthly") return { type: "monthly", day: new Date().getUTCDate() };
    if (word in WEEKDAYS) return { type: "weekly", weekday: WEEKDAYS[word] };
    return null;
  }
  m = t.match(/\b(daily|weekly|monthly)\s*$/);
  if (m) {
    if (m[1] === "daily") return { type: "daily" };
    if (m[1] === "weekly") return { type: "weekly", weekday: new Date().getUTCDay() };
    return { type: "monthly", day: new Date().getUTCDate() };
  }
  return null;
}

export function describeCadence(cadence: DcaCadence): string {
  if (cadence.type === "daily") return "daily";
  if (cadence.type === "weekly") {
    const name = Object.entries(WEEKDAYS).find(([, n]) => n === cadence.weekday)?.[0] ?? "weekly";
    return `every ${name[0].toUpperCase()}${name.slice(1)}`;
  }
  return "monthly";
}

/**
 * Nominal period per cadence. Monthly is a fixed 30 days (documented
 * approximation — fires are mechanical proposals, not calendar contracts).
 */
export function cadencePeriodMs(cadence: DcaCadence): number {
  if (cadence.type === "daily") return DAY_MS;
  if (cadence.type === "weekly") return 7 * DAY_MS;
  return 30 * DAY_MS;
}

/** First fire strictly after `fromMs`. */
export function advanceCadence(cadence: DcaCadence, fromMs: number): number {
  return fromMs + cadencePeriodMs(cadence);
}

// --- baskets (PreStocks-only) -----------------------------------------------

const AI_BASKET = ["OPENAI", "ANTHROPIC"];

/** Basket name (lowercase, trimmed) → ordered constituent symbols. */
const BASKETS: Record<string, string[]> = {
  index: [...STOCK_SYMBOLS],
  "prestocks index": [...STOCK_SYMBOLS],
  "index fund": [...STOCK_SYMBOLS],
  basket: [...STOCK_SYMBOLS],
  ai: [...AI_BASKET],
  "ai basket": [...AI_BASKET],
};

export function availableBaskets(): string[] {
  return ["index", "ai"];
}

/** Resolve user phrasing to ordered constituent symbols, or null. */
export function resolveBasket(name: string): string[] | null {
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  return BASKETS[key] ? [...BASKETS[key]] : null;
}

export interface BasketShare {
  symbol: string;
  /** Token base units for this constituent (floored, never exceeds the share). */
  amount: bigint;
}

/**
 * Split a total USD amount equally across constituents, converting via
 * PreStocks `tokenPrice` (USD per whole token). Returns null when any
 * constituent lacks a positive price — the caller must clarify instead of
 * guessing a split. Floors to whole base units so the sum never exceeds the
 * requested total.
 */
export function splitBasket(
  totalUsd: number,
  constituents: string[],
  prices: Map<string, number>,
  decimalsFor: (symbol: string) => number,
): BasketShare[] | null {
  if (!Number.isFinite(totalUsd) || totalUsd <= 0 || constituents.length === 0) return null;
  const perUsd = totalUsd / constituents.length;
  const out: BasketShare[] = [];
  for (const symbol of constituents) {
    const price = prices.get(symbol);
    if (!price || !Number.isFinite(price) || price <= 0) return null;
    const factor = 10 ** decimalsFor(symbol);
    out.push({ symbol, amount: BigInt(Math.floor((perUsd / price) * factor)) });
  }
  if (out.some((s) => s.amount <= 0n)) return null;
  return out;
}
