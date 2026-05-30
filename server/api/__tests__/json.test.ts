import { describe, expect, test } from "bun:test";

import {
  readAllowListKind,
  readBaseUnits,
  readJson,
  readNumber,
  readOwnerAction,
  readPolicyPatch,
  readString,
  readStringArray,
  readTokenEnvelopeConfig,
  readUnsignedOwnerTransaction,
  assertSameOrigin,
} from "../json";
import { makeRequest } from "../../testing/fixtures";

const URL = "https://praxis.test/api/praxis/send";

describe("readJson", () => {
  test("parses a JSON object body", async () => {
    const body = await readJson(makeRequest(URL, { body: { a: 1 } }));
    expect(body).toEqual({ a: 1 });
  });

  test("treats an empty body as an empty object", async () => {
    expect(await readJson(makeRequest(URL, { method: "POST" }))).toEqual({});
  });

  test("rejects an array body", async () => {
    await expect(readJson(makeRequest(URL, { body: [1, 2] }))).rejects.toThrow(/must be an object/);
  });

  test("rejects invalid JSON", async () => {
    await expect(readJson(makeRequest(URL, { body: "{not json" }))).rejects.toThrow(/valid JSON/);
  });

  test("rejects a body over the size cap by declared content-length", async () => {
    const req = makeRequest(URL, { body: { x: "a" }, headers: { "content-length": String(64 * 1024 + 1) } });
    await expect(readJson(req)).rejects.toThrow(/bytes or smaller/);
  });

  test("rejects an oversized actual body", async () => {
    const big = "x".repeat(64 * 1024 + 10);
    await expect(readJson(makeRequest(URL, { body: { big } }))).rejects.toThrow(/bytes or smaller/);
  });
});

describe("scalar readers", () => {
  test("readString trims and enforces maxLength", () => {
    expect(readString("  hi  ", "field")).toBe("hi");
    expect(() => readString("", "field")).toThrow(/non-empty/);
    expect(() => readString("toolong", "field", { maxLength: 3 })).toThrow(/3 characters or fewer/);
  });

  test("readBaseUnits accepts integer strings within u64 and rejects floats/negatives/overflow", () => {
    expect(readBaseUnits("1000", "amt")).toBe(1000n);
    expect(() => readBaseUnits("1.5", "amt")).toThrow();
    expect(() => readBaseUnits("-1", "amt")).toThrow(/unsigned 64-bit/);
    expect(() => readBaseUnits((2n ** 64n).toString(), "amt")).toThrow(/unsigned 64-bit/);
  });

  test("readNumber requires a safe integer", () => {
    expect(readNumber(5, "n")).toBe(5);
    expect(() => readNumber(1.5, "n")).toThrow(/safe integer/);
    expect(() => readNumber(Number.MAX_SAFE_INTEGER + 1, "n")).toThrow(/safe integer/);
  });

  test("readStringArray validates items and caps", () => {
    expect(readStringArray(["a", "b"], "arr")).toEqual(["a", "b"]);
    expect(readStringArray(undefined, "arr")).toEqual([]);
    expect(() => readStringArray("x", "arr")).toThrow(/must be an array/);
    expect(() => readStringArray(["a", "b", "c"], "arr", { maxItems: 2 })).toThrow(/2 items or fewer/);
  });

  test("readAllowListKind only accepts the three kinds", () => {
    expect(readAllowListKind("mints")).toBe("mints");
    expect(() => readAllowListKind("nope")).toThrow();
  });

  test("readPolicyPatch validates each optional field", () => {
    expect(readPolicyPatch({ maxPerTx: "10", paused: true })).toEqual({
      maxPerTx: 10n,
      dailyLimit: undefined,
      expiryTs: undefined,
      paused: true,
    });
    expect(() => readPolicyPatch({ paused: "yes" })).toThrow(/boolean/);
    expect(() => readPolicyPatch([])).toThrow(/must be an object/);
  });

  test("readTokenEnvelopeConfig requires mint and both caps", () => {
    expect(
      readTokenEnvelopeConfig({ tokenMint: "M", tokenMaxPerTx: "5", tokenDailyLimit: "50" }),
    ).toEqual({ tokenMint: "M", tokenMaxPerTx: 5n, tokenDailyLimit: 50n });
    expect(() => readTokenEnvelopeConfig({ tokenMint: "M", tokenMaxPerTx: "5" })).toThrow();
  });
});

describe("readOwnerAction", () => {
  test("accepts revoke and rotate", () => {
    expect(readOwnerAction({ kind: "revoke" })).toEqual({ kind: "revoke" });
    expect(readOwnerAction({ kind: "rotate" })).toEqual({ kind: "rotate" });
  });

  test("parses an updatePolicy patch", () => {
    expect(readOwnerAction({ kind: "updatePolicy", patch: { maxPerTx: "10", paused: true } })).toEqual({
      kind: "updatePolicy",
      patch: { maxPerTx: 10n, dailyLimit: undefined, expiryTs: undefined, paused: true },
    });
  });

  test("parses an allowList action and validates the mode", () => {
    expect(readOwnerAction({ kind: "allowList", listKind: "mints", address: "Mint11111", mode: "add" })).toEqual({
      kind: "allowList",
      listKind: "mints",
      address: "Mint11111",
      mode: "add",
    });
    expect(() => readOwnerAction({ kind: "allowList", listKind: "mints", address: "x", mode: "nope" })).toThrow(
      /add or remove/,
    );
  });

  test("rejects an unknown kind and non-objects", () => {
    expect(() => readOwnerAction({ kind: "selfDestruct" })).toThrow(/updatePolicy, allowList, revoke, or rotate/);
    expect(() => readOwnerAction("revoke")).toThrow(/must be an object/);
  });
});

describe("readUnsignedOwnerTransaction", () => {
  test("requires transaction, blockhash, and a numeric lastValidBlockHeight", () => {
    expect(
      readUnsignedOwnerTransaction({ transaction: "AQID", blockhash: "abc", lastValidBlockHeight: 99 }),
    ).toEqual({ transaction: "AQID", blockhash: "abc", lastValidBlockHeight: 99 });
    expect(() => readUnsignedOwnerTransaction({ transaction: "AQID", blockhash: "abc" })).toThrow();
    expect(() =>
      readUnsignedOwnerTransaction({ transaction: "AQID", blockhash: "abc", lastValidBlockHeight: 1.5 }),
    ).toThrow(/safe integer/);
  });
});

describe("assertSameOrigin", () => {
  test("allows a same-origin request", () => {
    expect(() => assertSameOrigin(makeRequest(URL, { origin: "https://praxis.test" }))).not.toThrow();
  });

  test("allows a request with no Origin header (non-browser client)", () => {
    expect(() => assertSameOrigin(makeRequest(URL))).not.toThrow();
  });

  test("rejects a cross-origin request", () => {
    expect(() => assertSameOrigin(makeRequest(URL, { origin: "https://evil.test" }))).toThrow(/Cross-origin/);
  });
});
