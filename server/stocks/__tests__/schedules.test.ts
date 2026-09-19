import { describe, expect, test } from "bun:test";

import {
  advanceCadence,
  availableBaskets,
  cadencePeriodMs,
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
  test("periods are nominal and documented", () => {
    expect(cadencePeriodMs({ type: "daily" })).toBe(86_400_000);
    expect(cadencePeriodMs({ type: "weekly", weekday: 1 })).toBe(7 * 86_400_000);
    expect(cadencePeriodMs({ type: "monthly", day: 1 })).toBe(30 * 86_400_000);
  });

  test("advance moves strictly forward", () => {
    const now = Date.UTC(2026, 8, 19);
    expect(advanceCadence({ type: "weekly", weekday: 1 }, now)).toBe(now + 7 * 86_400_000);
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
