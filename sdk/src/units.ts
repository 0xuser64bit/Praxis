/**
 * Money helpers. Praxis money crosses the wire as decimal strings of integer
 * base units (lamports / token base units). These convert to/from `bigint` and
 * human decimal amounts without floats.
 */

/** An optionally-signed decimal integer — the only valid base-unit string. */
const INTEGER_RE = /^-?\d+$/;

/**
 * Parse a base-unit string (or bigint) into a bigint. Rejects floats, hex, and
 * other non-decimal-integer input so the SDK and server agree on what a valid
 * base-unit string is (mirrors the server's `parseUnits`).
 */
export function toBaseUnits(value: string | bigint): bigint {
  if (typeof value === "bigint") return value;
  const trimmed = value.trim();
  if (!INTEGER_RE.test(trimmed)) {
    throw new Error(`toBaseUnits: expected an integer base-unit string, got "${value}"`);
  }
  return BigInt(trimmed);
}

/**
 * Serialize a bigint (or a whole, safe-integer number of base units) into a
 * base-unit string. A non-integer or unsafe `number` throws rather than
 * silently losing precision.
 */
export function fromBaseUnits(value: bigint | number): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(`fromBaseUnits: number must be a safe integer, got ${value}`);
  }
  return BigInt(value).toString();
}

/** Convert a human decimal amount ("0.5") into base units for `decimals` places. */
export function humanToBaseUnits(amount: string, decimals: number): string {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`invalid decimal amount: "${amount}"`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`"${amount}" has more than ${decimals} decimal places`);
  }
  const padded = fraction.padEnd(decimals, "0");
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0")).toString();
}

/** Convert base units into a human decimal string for `decimals` places. */
export function baseUnitsToHuman(value: string | bigint, decimals: number): string {
  const units = toBaseUnits(value);
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const fraction = (abs % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}
