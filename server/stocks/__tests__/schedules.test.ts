import { describe, expect, test } from "bun:test";

import {
  advanceCadence,
  availableBaskets,
  describeCadence,
  nextFireAt,
  parseCadence,
  resolveBasket,
  sameCadence,
  splitBasket,
  usdToBaseUnits,
} from "../schedules";

describe("parseCadence", () => {
  test("weekday phrasing", () => {
    expect(parseCadence("every monday")).toEqual({ type: "weekly", weekday: 1 });
    expect(parseCadence("every Sunday")).toEqual({ type: "weekly", weekday: 0 });
  });

  test("shorthands", () => {
    expect(parseCadence("daily")?.type).toBe("daily");
    expect(parseCadence("weekly")?.type).toBe("weekly");
    expect(parseCadence("monthly")?.type).toBe("monthly");
    expect(parseCadence("every day")?.type).toBe("daily");
    expect(parseCadence("every month")?.type).toBe("monthly");
  });

  test("unanchored phrasing anchors to the supplied clock, not a hidden one", () => {
    const wednesday = Date.UTC(2026, 8, 16, 10, 0, 0); // 2026-09-16 is a Wednesday
    expect(parseCadence("weekly", wednesday)).toEqual({ type: "weekly", weekday: 3 });
    expect(parseCadence("monthly", wednesday)).toEqual({ type: "monthly", day: 16 });
  });

  test("garbage returns null", () => {
    expect(parseCadence("every someday")).toBeNull();
    expect(parseCadence("sometimes")).toBeNull();
    expect(parseCadence("")).toBeNull();
  });

  test("describe round-trips", () => {
    expect(describeCadence({ type: "weekly", weekday: 1 })).toBe("every Monday");
    expect(describeCadence({ type: "daily" })).toBe("daily");
    expect(describeCadence({ type: "monthly", day: 15 })).toBe("monthly");
  });
});

describe("cadence math", () => {
  const DAY = 86_400_000;
  const utcDay = (ms: number) => new Date(ms).getUTCDay();

  test("daily advances exactly one day, keeping the time of day", () => {
    const at = Date.UTC(2026, 8, 19, 14, 30);
    expect(advanceCadence({ type: "daily" }, at)).toBe(at + DAY);
  });

  test("weekly lands on the named weekday, not creation-day + 7", () => {
    // 2026-09-16 is a Wednesday; "every Monday" must reach Monday the 21st,
    // five days out — not the following Wednesday.
    const wednesday = Date.UTC(2026, 8, 16, 9, 0);
    const next = advanceCadence({ type: "weekly", weekday: 1 }, wednesday);
    expect(next).toBe(Date.UTC(2026, 8, 21, 9, 0));
    expect(utcDay(next)).toBe(1);
  });

  test("weekly from the target weekday skips a full week, never the same instant", () => {
    const monday = Date.UTC(2026, 8, 21, 9, 0);
    const next = advanceCadence({ type: "weekly", weekday: 1 }, monday);
    expect(next).toBe(monday + 7 * DAY);
    expect(utcDay(next)).toBe(1);
  });

  test("weekly stays on its weekday across many fires", () => {
    let at = Date.UTC(2026, 8, 16, 9, 0);
    for (let i = 0; i < 20; i++) {
      at = advanceCadence({ type: "weekly", weekday: 4 }, at);
      expect(utcDay(at)).toBe(4);
    }
  });

  test("monthly lands on its day-of-month instead of drifting by 30 days", () => {
    const jan15 = Date.UTC(2026, 0, 15, 12, 0);
    const feb15 = advanceCadence({ type: "monthly", day: 15 }, jan15);
    expect(feb15).toBe(Date.UTC(2026, 1, 15, 12, 0));
    expect(advanceCadence({ type: "monthly", day: 15 }, feb15)).toBe(Date.UTC(2026, 2, 15, 12, 0));
  });

  test("monthly clamps to short months rather than skipping or spilling over", () => {
    const jan31 = Date.UTC(2026, 0, 31, 8, 0);
    const feb = advanceCadence({ type: "monthly", day: 31 }, jan31);
    expect(feb).toBe(Date.UTC(2026, 1, 28, 8, 0)); // 2026 is not a leap year
    expect(advanceCadence({ type: "monthly", day: 31 }, feb)).toBe(Date.UTC(2026, 2, 31, 8, 0));
  });

  test("monthly crosses the year boundary", () => {
    const dec10 = Date.UTC(2026, 11, 10, 6, 0);
    expect(advanceCadence({ type: "monthly", day: 10 }, dec10)).toBe(Date.UTC(2027, 0, 10, 6, 0));
  });

  test("every cadence moves strictly forward from any instant", () => {
    const at = Date.UTC(2026, 1, 28, 23, 59, 59, 999);
    for (const cadence of [
      { type: "daily" } as const,
      { type: "weekly", weekday: 0 } as const,
      { type: "weekly", weekday: 6 } as const,
      { type: "monthly", day: 1 } as const,
      { type: "monthly", day: 31 } as const,
    ]) {
      expect(advanceCadence(cadence, at)).toBeGreaterThan(at);
    }
  });
});

describe("baskets", () => {
  test("known baskets resolve in stable order", () => {
    expect(resolveBasket("index")).toHaveLength(8);
    expect(resolveBasket("AI BASKET")).toEqual(["OPENAI", "ANTHROPIC"]);
    expect(resolveBasket("prestocks index")).toHaveLength(8);
  });

  test("unknown names return null (never a guessed split)", () => {
    expect(resolveBasket("mag7")).toBeNull();
    expect(resolveBasket("")).toBeNull();
  });

  test("menu lists only real baskets", () => {
    expect(availableBaskets()).toEqual(["index", "ai"]);
  });
});

describe("splitBasket", () => {
  test("splits USD equally and converts via prices", () => {
    const out = splitBasket(60, ["OPENAI", "ANTHROPIC"], new Map([["OPENAI", 10], ["ANTHROPIC", 20]]), () => 6);
    expect(out).toEqual([
      { symbol: "OPENAI", amount: 3_000_000n },
      { symbol: "ANTHROPIC", amount: 1_500_000n },
    ]);
  });

  test("missing or non-positive price voids the split", () => {
    expect(splitBasket(60, ["OPENAI", "X"], new Map([["OPENAI", 10]]), () => 6)).toBeNull();
    expect(splitBasket(60, ["OPENAI"], new Map([["OPENAI", 0]]), () => 6)).toBeNull();
  });

  test("dust that floors to zero voids the split", () => {
    expect(splitBasket(0.000001, ["OPENAI"], new Map([["OPENAI", 10]]), () => 6)).toBeNull();
  });

  test("invalid totals return null", () => {
    expect(splitBasket(0, ["OPENAI"], new Map([["OPENAI", 10]]), () => 6)).toBeNull();
    expect(splitBasket(NaN, ["OPENAI"], new Map([["OPENAI", 10]]), () => 6)).toBeNull();
  });
});

describe("sameCadence", () => {
  test("equal rhythms match, different ones do not", () => {
    expect(sameCadence({ type: "daily" }, { type: "daily" })).toBe(true);
    expect(sameCadence({ type: "weekly", weekday: 1 }, { type: "weekly", weekday: 1 })).toBe(true);
    expect(sameCadence({ type: "weekly", weekday: 1 }, { type: "weekly", weekday: 2 })).toBe(false);
    expect(sameCadence({ type: "monthly", day: 15 }, { type: "monthly", day: 15 })).toBe(true);
    expect(sameCadence({ type: "monthly", day: 15 }, { type: "monthly", day: 1 })).toBe(false);
    expect(sameCadence({ type: "daily" }, { type: "weekly", weekday: 1 })).toBe(false);
  });
});

describe("anchoring to the scheduler's hour", () => {
  const HOUR = 9; // matches the `0 9 * * *` cron in vercel.json
  const utcDay = (ms: number) => new Date(ms).getUTCDay();
  const utcHour = (ms: number) => new Date(ms).getUTCHours();

  /**
   * Firing is ONE daily cron tick. A schedule whose time-of-day sits after
   * that tick is never due when the tick runs, so it slips to the next day —
   * "every Monday" would fire on Tuesday. These pin the fix.
   */
  test("a weekly schedule fires on its weekday whatever time it was created", () => {
    // 2026-09-20 is a Sunday. Create at every hour of the day.
    for (let createdHour = 0; createdHour < 24; createdHour++) {
      const created = Date.UTC(2026, 8, 20, createdHour, 30);
      const next = nextFireAt({ type: "weekly", weekday: 1 }, created, HOUR);
      expect(utcDay(next)).toBe(1);
      expect(utcHour(next)).toBe(HOUR);
      expect(next).toBeGreaterThan(created);
    }
  });

  test("the first cron tick on or after the fire time is on the promised day", () => {
    for (let createdHour = 0; createdHour < 24; createdHour++) {
      const created = Date.UTC(2026, 8, 20, createdHour, 30);
      const next = nextFireAt({ type: "weekly", weekday: 1 }, created, HOUR);
      // The tick runs at HOUR:00–HOUR:59; a schedule at HOUR:00 is due on it.
      const d = new Date(next);
      const tick = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), HOUR, 0);
      expect(tick).toBeGreaterThanOrEqual(next);
      expect(utcDay(tick)).toBe(1);
    }
  });

  test("today's slot is used when it has not passed, skipped when it has", () => {
    const early = Date.UTC(2026, 8, 21, 6, 0); // Monday 06:00, before the tick
    expect(nextFireAt({ type: "weekly", weekday: 1 }, early, HOUR)).toBe(
      Date.UTC(2026, 8, 21, HOUR, 0),
    );
    const late = Date.UTC(2026, 8, 21, 15, 0); // Monday 15:00, after the tick
    expect(nextFireAt({ type: "weekly", weekday: 1 }, late, HOUR)).toBe(
      Date.UTC(2026, 8, 28, HOUR, 0),
    );
  });

  test("daily and monthly anchor too", () => {
    const at = Date.UTC(2026, 8, 20, 15, 0);
    expect(nextFireAt({ type: "daily" }, at, HOUR)).toBe(Date.UTC(2026, 8, 21, HOUR, 0));
    expect(nextFireAt({ type: "monthly", day: 20 }, at, HOUR)).toBe(
      Date.UTC(2026, 9, 20, HOUR, 0),
    );
  });

  test("subsequent fires keep the anchored hour", () => {
    let at = nextFireAt({ type: "weekly", weekday: 4 }, Date.UTC(2026, 8, 20, 22, 0), HOUR);
    for (let i = 0; i < 8; i++) {
      expect(utcHour(at)).toBe(HOUR);
      expect(utcDay(at)).toBe(4);
      at = advanceCadence({ type: "weekly", weekday: 4 }, at);
    }
  });
});

describe("splitBasket precision", () => {
  const decimals9 = () => 9;

  test("a cheap token on a 9-decimal mint does not lose precision", () => {
    // (60 / 0.000001) * 1e9 is 6e16 — past 2^53, where a double silently
    // rounds. This is the quantity the proposal asks the owner to sign, not
    // an estimate.
    const shares = splitBasket(60, ["CHEAP"], new Map([["CHEAP", 0.000001]]), decimals9)!;
    expect(shares[0].amount).toBe(60_000_000_000_000_000n);
  });

  test("floors rather than rounding up, so the split never exceeds the total", () => {
    const shares = splitBasket(10, ["A", "B"], new Map([["A", 3], ["B", 3]]), () => 6)!;
    // 5 / 3 = 1.666… → 1_666_666 base units at 6dp, floored.
    expect(shares.map((s) => s.amount)).toEqual([1_666_666n, 1_666_666n]);
  });

  test("a single-stock dollar amount floors to base units, never guessing a price", () => {
    // $40 of OPENAI at $1,088.50 on a 9-decimal mint: 0.036747818…, floored.
    expect(usdToBaseUnits(40, 1088.5, 9)).toBe(36_747_818n);
    expect(usdToBaseUnits(40, 0, 9)).toBeNull();
    expect(usdToBaseUnits(0, 1088.5, 9)).toBeNull();
    expect(usdToBaseUnits(0.0000001, 1088.5, 0)).toBe(0n);
  });

  test("an unpriceable or zero-quantity constituent voids the whole basket", () => {
    expect(splitBasket(10, ["A", "B"], new Map([["A", 3]]), () => 6)).toBeNull();
    expect(splitBasket(1, ["A"], new Map([["A", 1000]]), () => 0)).toBeNull();
    expect(splitBasket(0, ["A"], new Map([["A", 1]]), () => 6)).toBeNull();
  });
});
