import { describe, expect, test } from "bun:test";

import {
  advanceCadence,
  availableBaskets,
  describeCadence,
  parseCadence,
  resolveBasket,
  sameCadence,
  splitBasket,
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
