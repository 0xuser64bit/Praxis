import { describe, expect, test } from "bun:test";

import { formatElapsed, labelFor } from "../Thinking";

/**
 * The working indicator's only claims are a word and a number, and both are
 * shown to someone deciding whether a send has hung. A readout that rolls the
 * minute wrong reads as a shorter wait than it is, and a label still saying
 * "thinking" at a minute is the thing the escalation exists to prevent.
 */
describe("Thinking readout", () => {
  test("tenths below a minute, minutes above it", () => {
    expect(formatElapsed(0)).toBe("0.0s");
    expect(formatElapsed(3.4)).toBe("3.4s");
    expect(formatElapsed(59.9)).toBe("59.9s");
    // Rounds up THROUGH the minute, not to a "60.0s" that never rolls.
    expect(formatElapsed(59.97)).toBe("1m 0.0s");
    expect(formatElapsed(60)).toBe("1m 0.0s");
    expect(formatElapsed(64.2)).toBe("1m 4.2s");
    expect(formatElapsed(125.5)).toBe("2m 5.5s");
  });

  test("the label escalates once, at twelve seconds", () => {
    expect(labelFor(0)).toBe("thinking");
    expect(labelFor(11.9)).toBe("thinking");
    expect(labelFor(12)).toBe("still working");
    expect(labelFor(600)).toBe("still working");
  });
});
