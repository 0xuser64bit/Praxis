/**
 * Base-unit math + display formatting for Praxis.
 *
 * THE MONEY RULE: values are integer base units (`bigint`). Parsing a human
 * amount → base units is pure string/bigint arithmetic (no `Number`, no float).
 * Conversion to a human/USD string happens ONLY here, at the display edge.
 */

export const LAMPORTS_PER_SOL_DECIMALS = 9;

/** Display-only spot rates. Approximate, used to render "≈ $…" — never for accounting. */
export const DISPLAY_RATES_USD: Record<string, number> = {
  SOL: 186.42,
  USDC: 1,
  JUP: 1.14,
  BONK: 0.0000273,
};

/**
 * Parse a human decimal amount into integer base units. Pure string math so no
 * float ever touches a monetary value. Throws on malformed input or on more
 * fractional digits than the asset supports.
 */
export function toBaseUnits(human: string, decimals: number): bigint {
  const s = human.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new TypeError(`toBaseUnits: expected a positive decimal, got "${human}"`);
  }
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) {
    throw new RangeError(
      `toBaseUnits: "${human}" has more than ${decimals} fractional digits`,
    );
  }
  const scaled = frac.padEnd(decimals, "0");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(scaled || "0");
}

function withThousands(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format base units → a human string. Trims trailing zeros down to `minFrac`,
 * caps at `maxFrac`, and groups the integer part with thousands separators.
 */
export function formatUnits(
  units: bigint,
  decimals: number,
  { maxFrac = decimals, minFrac = 0 }: { maxFrac?: number; minFrac?: number } = {},
): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;

  let fracStr = frac.toString().padStart(decimals, "0").slice(0, maxFrac);
  // strip trailing zeros but keep at least minFrac digits
  while (fracStr.length > minFrac && fracStr.endsWith("0")) {
    fracStr = fracStr.slice(0, -1);
  }

  const wholeStr = withThousands(whole.toString());
  return (neg ? "-" : "") + (fracStr ? `${wholeStr}.${fracStr}` : wholeStr);
}

/** Convenience: lamports → "0.5" style SOL string (max 4 dp). */
export function formatSol(lamports: bigint, maxFrac = 4): string {
  return formatUnits(lamports, LAMPORTS_PER_SOL_DECIMALS, { maxFrac });
}

/**
 * Approximate USD display for an amount. Float math is acceptable HERE because
 * it is purely a display annotation ("≈ $93.21") — it never feeds back into
 * any base-unit value.
 */
export function formatUsd(units: bigint, decimals: number, symbol: string): string {
  const rate = DISPLAY_RATES_USD[symbol] ?? 0;
  const human = Number(units) / 10 ** decimals;
  const usd = human * rate;
  const digits = usd > 0 && usd < 1 ? 4 : 2;
  return `≈ $${usd.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** first4…last4 address shortener. */
export function shortenAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  // `slice(-0)` is `slice(0)` (returns the whole string), so guard tail === 0.
  const end = tail > 0 ? address.slice(-tail) : "";
  return `${address.slice(0, lead)}…${end}`;
}

/** Percentage of `part` against `whole`, clamped to [0,100], for meters. */
export function percentOf(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  // scale to keep integer precision, then convert at the edge
  const scaled = (part * 10000n) / whole;
  const pct = Number(scaled) / 100;
  return Math.max(0, Math.min(100, pct));
}
