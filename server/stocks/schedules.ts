import { STOCK_SYMBOLS } from "./universe";

/**
 * Mechanical DCA schedules + basket definitions. Pure module —
 * no env, no I/O — so cadence math and basket splits are unit-testable.
 *
 * Operating rules:
 * - A schedule NEVER signs. Each fire emits one transfer proposal through the
 *   same `checkTokenTransferPolicy` path as a one-off buy; the user signs.
 * - A basket NEVER partially signs. All constituents are simulated first; if
 *   any is blocked, the whole basket becomes a clarification and nothing is
 *   stored. Amounts never move until each proposal is individually signed.
 * - Baskets contain ONLY PreStocks pre-IPO mints.
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
  const monthlyDay = t.match(/^(?:every\s+month|monthly)(?:\s+on(?:\s+the)?\s+(?:day\s+)?(\d{1,2})(?:st|nd|rd|th)?)?$/);
  if (monthlyDay) {
    const day = monthlyDay[1] ? Number(monthlyDay[1]) : now.getUTCDate();
    if (day >= 1 && day <= 31) return { type: "monthly", day };
  }
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

export function formatCadenceForReplay(cadence: DcaCadence): string {
  if (cadence.type === "monthly") return `monthly on day ${cadence.day}`;
  return describeCadence(cadence);
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
 * Advance a schedule past `nowMs`, firing once for a missed stretch rather
 * than once per missed period.
 *
 * A schedule that has been due since last month should produce one card, not
 * thirty. The hop budget is what stops a pathological cadence from spinning;
 * past it the next fire is computed from now.
 */
const MAX_CATCH_UP_HOPS = 1_000;

export function advancePast(cadence: DcaCadence, from: number, nowMs: number): number {
  let next = from;
  for (let hops = 0; hops < MAX_CATCH_UP_HOPS; hops++) {
    if (next > nowMs) return next;
    next = advanceCadence(cadence, next);
  }
  return advanceCadence(cadence, nowMs);
}

/**
 * The first fire strictly after `nowMs`, on a cadence-matching day, at
 * `hourUtc`.
 *
 * Schedules must be anchored to the hour the scheduler actually runs. Firing
 * is driven by one daily cron tick, so a schedule whose time-of-day sits
 * after that tick is never due when the tick runs and only fires on the NEXT
 * one — "every Monday" created at 15:00 would fire on Tuesday. Anchoring the
 * stored `nextFireTs` to the tick's hour is what keeps the label honest.
 *
 * The cron has up to an hour of jitter, which is harmless in this direction:
 * a tick at 09:00–09:59 always finds an 09:00 schedule due.
 */
export function nextFireAt(cadence: DcaCadence, nowMs: number, hourUtc: number): number {
  const today = atUtcHour(nowMs, hourUtc);
  // Today's slot counts only if it has not already passed.
  if (today > nowMs && matchesCadence(cadence, today)) return today;
  return advanceCadence(cadence, today);
}

/** `ms` moved to `hourUtc:00:00.000` on the same UTC day. */
function atUtcHour(ms: number, hourUtc: number): number {
  const d = new Date(ms);
  const hour = Math.min(Math.max(Math.trunc(hourUtc) || 0, 0), 23);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0, 0);
}

/** Whether `ms` falls on a day this cadence fires. */
function matchesCadence(cadence: DcaCadence, ms: number): boolean {
  if (cadence.type === "daily") return true;
  const d = new Date(ms);
  if (cadence.type === "weekly") return d.getUTCDay() === normalizeWeekday(cadence.weekday);
  const wanted = Math.min(Math.max(Math.trunc(cadence.day) || 1, 1), 31);
  const lastDay = daysInUtcMonth(d.getUTCFullYear(), d.getUTCMonth());
  return d.getUTCDate() === Math.min(wanted, lastDay);
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

/** Fixed-point scale for USD figures inside the split (8 decimal places). */
const USD_SCALE = 100_000_000n;

/** A positive USD amount as scaled integer cents-of-cents, or null. */
function toScaledUsd(value: number): bigint | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const scaled = BigInt(Math.round(value * Number(USD_SCALE)));
  return scaled > 0n ? scaled : null;
}

/**
 * Split a total USD amount equally across constituents, converting via
 * PreStocks `tokenPrice` (USD per whole token). Returns null when any
 * constituent lacks a positive price — the caller must clarify instead of
 * guessing a split. Floors to whole base units so the sum never exceeds the
 * requested total.
 *
 * The division runs in integer space. `(usd / price) * 10 ** decimals` as a
 * double silently loses precision the moment it crosses 2^53, which a cheap
 * token on a 9-decimal mint does at around sixty dollars — and the result is
 * not an estimate, it is the quantity the proposal asks the owner to sign.
 */
export function splitBasket(
  totalUsd: number,
  constituents: string[],
  prices: Map<string, number>,
  decimalsFor: (symbol: string) => number,
): BasketShare[] | null {
  if (constituents.length === 0) return null;
  const total = toScaledUsd(totalUsd);
  if (total === null) return null;

  const perUsd = total / BigInt(constituents.length);
  const out: BasketShare[] = [];
  for (const symbol of constituents) {
    const amount = scaledUsdToBaseUnits(perUsd, prices.get(symbol) ?? 0, decimalsFor(symbol));
    if (amount === null || amount <= 0n) return null;
    out.push({ symbol, amount });
  }
  return out;
}

/**
 * A single-stock dollar amount ("buy $40 openai") in token base units, by the
 * same integer math as a basket share. Null when either figure is not a
 * positive number; 0n when the dollars are too small for one base unit.
 */
export function usdToBaseUnits(usd: number, priceUsd: number, decimals: number): bigint | null {
  const total = toScaledUsd(usd);
  return total === null ? null : scaledUsdToBaseUnits(total, priceUsd, decimals);
}

function scaledUsdToBaseUnits(scaledUsd: bigint, priceUsd: number, decimals: number): bigint | null {
  const price = toScaledUsd(priceUsd);
  if (price === null) return null;
  // Both sides carry USD_SCALE, so it cancels; the token scale is what is
  // left. Integer division floors, which is the direction that keeps the
  // result at or under the requested dollars.
  return (scaledUsd * 10n ** BigInt(decimals)) / price;
}
