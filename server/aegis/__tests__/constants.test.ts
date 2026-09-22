import { describe, expect, test } from "bun:test";
import { AEGIS_IDL_JSON } from "@praxis/shared";

import { AEGIS_ERROR_CODE_TO_REASON, AEGIS_OPERATIONAL_ERROR } from "../constants";

function isExplained(code: number): boolean {
  return AEGIS_ERROR_CODE_TO_REASON[code] !== undefined
    || AEGIS_OPERATIONAL_ERROR[code] !== undefined;
}

describe("Aegis error mapping", () => {
  test("every on-chain error code has a TS explanation", () => {
    const unmapped = AEGIS_IDL_JSON.errors
      .filter((error) => !isExplained(error.code))
      .map((error) => `${error.code} ${error.name}`);
    expect(unmapped).toEqual([]);
  });

  test("no TS mapping names a code the program does not define", () => {
    const onChain = new Set(AEGIS_IDL_JSON.errors.map((error) => error.code));
    const mapped = [
      ...Object.keys(AEGIS_ERROR_CODE_TO_REASON),
      ...Object.keys(AEGIS_OPERATIONAL_ERROR),
    ].map(Number);
    expect(mapped.filter((code) => !onChain.has(code))).toEqual([]);
  });

  test("a code is a policy verdict or an operational failure, never both", () => {
    const both = Object.keys(AEGIS_ERROR_CODE_TO_REASON)
      .map(Number)
      .filter((code) => AEGIS_OPERATIONAL_ERROR[code] !== undefined);
    expect(both).toEqual([]);
  });
});
