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
 *
 * Unanchored phrasing ("weekly", "monthly") anchors to `nowMs` — today's
 * weekday / day-of-month — which is why the clock is an argument rather than
 * a hidden `Date.now()` read: this module stays pure and testable.
 */
export function parseCadence(text: string, nowMs: number = Date.now()): DcaCadence | null {
  const t = text.toLowerCase().trim();
  const now = new Date(nowMs);
  let m = t.match(/\bevery\s+([a-z]+)\s*$/);
  if (m) {
    const word = m[1];
    if (word === "day" || word === "daily") return { type: "daily" };
    if (word === "week" || word === "weekly") {
      return { type: "weekly", weekday: now.getUTCDay() };
    }
    if (word === "month" || word === "monthly") return { type: "monthly", day: now.getUTCDate() };
    if (word in WEEKDAYS) return { type: "weekly", weekday: WEEKDAYS[word] };
    return null;
  }
  m = t.match(/\b(daily|weekly|monthly)\s*$/);
  if (m) {
    if (m[1] === "daily") return { type: "daily" };
    if (m[1] === "weekly") return { type: "weekly", weekday: now.getUTCDay() };
    return { type: "monthly", day: now.getUTCDate() };
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

/** True when two cadences fire on the same rhythm (used for duplicate detection). */
export function sameCadence(a: DcaCadence, b: DcaCadence): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "daily") return true;
  if (a.type === "weekly" && b.type === "weekly") return a.weekday === b.weekday;
  if (a.type === "monthly" && b.type === "monthly") return a.day === b.day;
  return false;
}

/**
 * First fire strictly after `fromMs`, on the calendar day the cadence names.
 *
 * This used to be `fromMs + 7 days` for weekly and `+ 30 days` for monthly,
 * which ignored the `weekday` / `day` the user actually asked for: a schedule
 * created on a Wednesday fired every Wednesday while the UI said "every
 * Monday", and a monthly buy drifted backwards through the calendar. Amounts
 * move on a schedule people read as a promise, so the promise has to hold.
 *
 * All arithmetic is UTC (matching `describeCadence` and the stored weekday),
 * so there is no DST discontinuity. Time-of-day is inherited from `fromMs` —
 * a schedule keeps firing at the hour it was created.
 */
export function advanceCadence(cadence: DcaCadence, fromMs: number): number {
  if (cadence.type === "daily") return fromMs + DAY_MS;

  if (cadence.type === "weekly") {
    const target = normalizeWeekday(cadence.weekday);
    const delta = (target - new Date(fromMs).getUTCDay() + 7) % 7;
    // A match on the same day means "next week", never "right now" — the
    // contract is strictly after `fromMs`.
    return fromMs + (delta === 0 ? 7 : delta) * DAY_MS;
  }

  return nextMonthlyFire(cadence.day, fromMs);
}

/**
 * Next occurrence of day-of-month `day`, clamped to the length of whichever
 * month it lands in — a "31st" schedule fires on the 30th in November and the
 * 28th/29th in February rather than skipping the month or spilling into the
 * next one.
 */
function nextMonthlyFire(day: number, fromMs: number): number {
  const from = new Date(fromMs);
  const hours = from.getUTCHours();
  const minutes = from.getUTCMinutes();
  const seconds = from.getUTCSeconds();
  const ms = from.getUTCMilliseconds();
  const wanted = Math.min(Math.max(Math.trunc(day) || 1, 1), 31);

  for (let offset = 0; offset <= 2; offset++) {
    const year = from.getUTCFullYear();
    const month = from.getUTCMonth() + offset;
    const candidate = Date.UTC(
      year,
      month,
      Math.min(wanted, daysInUtcMonth(year, month)),
      hours,
      minutes,
      seconds,
      ms,
    );
    if (candidate > fromMs) return candidate;
  }
  // Unreachable for any real input; a month ahead is a safe, forward answer.
  return fromMs + 30 * DAY_MS;
}

/** Days in the UTC month, tolerating a month index past December. */
function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function normalizeWeekday(weekday: number): number {
  const n = Math.trunc(weekday);
  return Number.isFinite(n) ? ((n % 7) + 7) % 7 : 0;
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
