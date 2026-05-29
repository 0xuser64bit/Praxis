/**
 * JSON-boundary helpers for the money rule: base units are `bigint` in memory
 * and decimal `string` on the wire. Use these at every API/storage boundary so
 * no float ever touches a monetary value.
 */

import type { BaseUnits } from "./types.js";

/** bigint base units → decimal string (for JSON). */
export function serializeUnits(units: BaseUnits): string {
  return units.toString();
}

/** decimal string | bigint → bigint base units. Rejects non-integers/floats. */
export function parseUnits(value: string | bigint): BaseUnits {
  if (typeof value === "bigint") return value;
  if (!/^-?\d+$/.test(value.trim())) {
    throw new TypeError(`parseUnits: expected integer base units, got "${value}"`);
  }
  return BigInt(value.trim());
}

/** `dailyLimit - spentToday`, floored at 0 — the canonical "remaining" calc. */
export function remaining(dailyLimit: BaseUnits, spentToday: BaseUnits): BaseUnits {
  const r = dailyLimit - spentToday;
  return r > 0n ? r : 0n;
}
