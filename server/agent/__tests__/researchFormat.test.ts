import { describe, expect, test } from "bun:test";

import { compactAmount, compactUsd, formatPrice, groupDigits } from "../researchFormat";

describe("a supply is a magnitude, not a digit-counting exercise", () => {
  test("the figure that started this reads as a magnitude, exactly as reported", () => {
    // Straight off the BONK mint: what the card used to print in full.
    expect(compactAmount("87994397952881.85356")).toEqual({
      value: "87.99T",
      exact: "87,994,397,952,881.85356",
    });
  });

  test("nothing is abbreviated below a million — the digits are already readable", () => {
    expect(compactAmount("2826.49")).toEqual({ value: "2,826.49" });
    expect(compactAmount("1000.000000")).toEqual({ value: "1,000" });
  });

  test("rounding to the nearest unit is the point, and the exact figure catches it", () => {
    // OFFICIAL TRUMP's real supply. "1B" is the honest read; the 943 tokens
    // it rounds past are on the hover, not lost.
    expect(compactAmount("999998943.309067")).toEqual({
      value: "1B",
      exact: "999,998,943.309067",
    });
  });

  test("a figure past what a double can hold survives as itself", () => {
    expect(compactAmount("not-a-number")).toEqual({ value: "not-a-number" });
  });
});

describe("USD figures", () => {
  test("large ones abbreviate and keep the exact figure", () => {
    expect(compactUsd(295_929_398)).toEqual({ value: "$295.93M", exact: "$295,929,398.00" });
    expect(compactUsd(1_041_870.75)).toEqual({ value: "$1.04M", exact: "$1,041,870.75" });
  });

  test("small ones are left alone", () => {
    expect(compactUsd(4_320.5)).toEqual({ value: "$4,320.50" });
  });
});

describe("a price needs the opposite treatment from a supply", () => {
  /**
   * The old formatter fixed the decimal places at four, so every memecoin
   * price under a hundredth of a cent rendered as "$0.0000" — the same
   * number for a coin worth a thousandth of a cent and one worth a billionth.
   */
  test("sub-cent prices keep their significant digits", () => {
    expect(formatPrice("0.000003363").value).toBe("$0.000003363");
    expect(formatPrice("0.00000000123").value).toBe("$0.00000000123");
  });

  test("ordinary prices read as money", () => {
    expect(formatPrice("2.19").value).toBe("$2.19");
    expect(formatPrice("1088.5").value).toBe("$1,088.50");
  });

  test("an absurd price still abbreviates rather than running off the card", () => {
    expect(formatPrice("12345678.9")).toEqual({ value: "$12.35M", exact: "$12,345,678.9" });
  });
});

test("digit grouping leaves the fraction and the sign alone", () => {
  expect(groupDigits("87994397952881.85356")).toBe("87,994,397,952,881.85356");
  expect(groupDigits("-1234.5")).toBe("-1,234.5");
  expect(groupDigits("abc")).toBe("abc");
});
