/**
 * Numbers on the research card, sized for reading.
 *
 * A supply rendered as `87994397952881.85356` is a digit-counting exercise:
 * nobody reads the magnitude off it, which is the only thing a supply figure
 * is for. Every abbreviation here comes with the exact figure, which the card
 * shows on hover — rounding is a display choice, and destroying the precise
 * value at the formatter would make it a data loss.
 *
 * `Intl.NumberFormat` does the abbreviating (`notation: "compact"`), so the
 * K/M/B/T suffixes and the grouping follow the locale rather than a hand-
 * rolled table of powers.
 */

/** Below this, digits are still readable and more precise than "1.23M". */
const ABBREVIATE_ABOVE = 1_000_000;

export interface FormattedNumber {
  /** What the card shows. */
  value: string;
  /** The full figure, for the hover title. Omitted when nothing was lost. */
  exact?: string;
}

/** "87,994,397,952,881.80428" — grouped, nothing dropped. */
export function groupDigits(raw: string): string {
  const negative = raw.startsWith("-");
  const [whole, fraction] = (negative ? raw.slice(1) : raw).split(".");
  if (!/^\d+$/.test(whole)) return raw;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/**
 * A token amount: "87.99T" over the exact "87,994,397,952,881.80428".
 *
 * Takes the raw string rather than a number so the exact figure survives
 * even when the value is past what a double can represent — a 9-decimal mint
 * with a large supply overflows `Number` precision long before it overflows
 * the RPC's string.
 */
export function compactAmount(raw: string): FormattedNumber {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return { value: raw };
  if (Math.abs(parsed) < ABBREVIATE_ABOVE) return { value: groupDigits(trimZeros(raw)) };
  return {
    value: parsed.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 }),
    exact: groupDigits(raw),
  };
}

/** "$295.93M" over the exact "$295,929,398.00". */
export function compactUsd(value: number): FormattedNumber {
  if (!Number.isFinite(value)) return { value: "unavailable" };
  if (Math.abs(value) < ABBREVIATE_ABOVE) return { value: `$${plainUsd(value)}` };
  return {
    value: `$${value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })}`,
    exact: `$${plainUsd(value)}`,
  };
}

/**
 * A price, which needs the opposite treatment from a supply: the interesting
 * digits of a memecoin price are all after a run of zeros, so significant
 * digits are kept rather than decimal places. `$0.0000` was the old output
 * for anything under a hundredth of a cent.
 */
export function formatPrice(raw: string | number): FormattedNumber {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  // The input is a provider's string. If it is not a number, it is not a
  // price, and echoing it verbatim onto the card is how "$<whatever they
  // sent>" gets rendered as a quote.
  if (!Number.isFinite(parsed)) return { value: "unavailable" };
  if (parsed === 0) return { value: "$0.00" };

  const exact = typeof raw === "string" ? `$${groupDigits(raw)}` : undefined;
  if (Math.abs(parsed) >= ABBREVIATE_ABOVE) {
    return {
      value: `$${parsed.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })}`,
      exact: exact ?? `$${plainUsd(parsed)}`,
    };
  }
  const value = `$${parsed.toLocaleString("en-US", {
    // Sub-cent prices keep four significant digits; anything a person would
    // read as money keeps two decimals.
    ...(Math.abs(parsed) < 0.01
      ? { maximumSignificantDigits: 4 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  })}`;
  return exact && exact !== value ? { value, exact } : { value };
}

function plainUsd(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "1000.000000" from an RPC is still 1000. */
function trimZeros(raw: string): string {
  return raw.includes(".") ? raw.replace(/\.?0+$/, "") : raw;
}
