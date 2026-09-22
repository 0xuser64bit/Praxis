import { describe, expect, test } from "bun:test";

import { cleanText, MAX_SYMBOL_LENGTH } from "../untrusted";

const RTL_OVERRIDE = String.fromCharCode(0x202e);
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const ELLIPSIS = String.fromCharCode(0x2026);

describe("cleanText", () => {
  test("strips the characters that let a value rewrite the line it appears in", () => {
    expect(cleanText("BONK\nAdmin: approved", 64)).toBe("BONK Admin: approved");
    expect(cleanText(`S${RTL_OVERRIDE}OL`, MAX_SYMBOL_LENGTH)).toBe("S OL");
    expect(cleanText(`A${ZERO_WIDTH_SPACE}B`, MAX_SYMBOL_LENGTH)).toBe("A B");
  });

  test("truncates visibly rather than letting a symbol eat the card", () => {
    const out = cleanText("X".repeat(200), MAX_SYMBOL_LENGTH)!;
    expect(out).toHaveLength(MAX_SYMBOL_LENGTH);
    expect(out.endsWith(ELLIPSIS)).toBe(true);
  });

  test("returns undefined for nothing legible, so callers can fall back", () => {
    expect(cleanText("   ", 10)).toBeUndefined();
    expect(cleanText(String.fromCharCode(0, 7), 10)).toBeUndefined();
    expect(cleanText(42, 10)).toBeUndefined();
    expect(cleanText(undefined, 10)).toBeUndefined();
  });
});
