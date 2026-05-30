import { afterEach, describe, expect, test } from "bun:test";

import { errorFields, logger, reportError } from "../logger";

function captureConsole() {
  const lines: { stream: string; text: string }[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (text: string) => lines.push({ stream: "log", text });
  console.warn = (text: string) => lines.push({ stream: "warn", text });
  console.error = (text: string) => lines.push({ stream: "error", text });
  return {
    lines,
    restore() {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

let prevLevel: string | undefined;

afterEach(() => {
  if (prevLevel === undefined) delete process.env.PRAXIS_LOG_LEVEL;
  else process.env.PRAXIS_LOG_LEVEL = prevLevel;
});

describe("logger", () => {
  test("emits one structured JSON line with level, msg, and fields", () => {
    prevLevel = process.env.PRAXIS_LOG_LEVEL;
    process.env.PRAXIS_LOG_LEVEL = "debug";
    const cap = captureConsole();
    try {
      logger.info("hello", { scope: "test", count: 3 });
    } finally {
      cap.restore();
    }
    expect(cap.lines).toHaveLength(1);
    const entry = JSON.parse(cap.lines[0].text);
    expect(entry).toMatchObject({ level: "info", msg: "hello", scope: "test", count: 3 });
    expect(typeof entry.time).toBe("string");
  });

  test("serializes bigint fields as strings (never floats)", () => {
    prevLevel = process.env.PRAXIS_LOG_LEVEL;
    process.env.PRAXIS_LOG_LEVEL = "debug";
    const cap = captureConsole();
    try {
      logger.warn("money", { amount: 9_007_199_254_740_993n });
    } finally {
      cap.restore();
    }
    const entry = JSON.parse(cap.lines[0].text);
    expect(entry.amount).toBe("9007199254740993");
  });

  test("respects the configured minimum level", () => {
    prevLevel = process.env.PRAXIS_LOG_LEVEL;
    process.env.PRAXIS_LOG_LEVEL = "error";
    const cap = captureConsole();
    try {
      logger.info("suppressed");
      logger.error("kept");
    } finally {
      cap.restore();
    }
    expect(cap.lines).toHaveLength(1);
    expect(JSON.parse(cap.lines[0].text).msg).toBe("kept");
  });

  test("reportError emits an error event with normalized error fields", () => {
    prevLevel = process.env.PRAXIS_LOG_LEVEL;
    process.env.PRAXIS_LOG_LEVEL = "debug";
    const cap = captureConsole();
    try {
      reportError(new Error("boom"), { route: "/x" });
    } finally {
      cap.restore();
    }
    const entry = JSON.parse(cap.lines[0].text);
    expect(cap.lines[0].stream).toBe("error");
    expect(entry).toMatchObject({ level: "error", route: "/x", errorName: "Error", errorMessage: "boom" });
  });

  test("errorFields normalizes non-Error throwables", () => {
    expect(errorFields("plain string")).toEqual({ errorMessage: "plain string" });
  });
});
