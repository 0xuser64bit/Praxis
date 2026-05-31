/**
 * Money helpers. Praxis money crosses the wire as decimal strings of integer
 * base units (lamports / token base units). These convert to/from `bigint` and
 * human decimal amounts without floats.
 */

/** Parse a base-unit string (or bigint) into a bigint. */
export function toBaseUnits(value: string | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value.trim());
}

/** Serialize a bigint (or number of whole base units) into a base-unit string. */
export function fromBaseUnits(value: bigint | number): string {
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
