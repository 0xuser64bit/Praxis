export const SOL_DECIMALS = 9;

export function parseHumanUnits(human: string, decimals: number): bigint {
  const s = human.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new TypeError(`expected a positive decimal amount, got "${human}"`);
  }

  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) {
    throw new RangeError(`"${human}" has more than ${decimals} decimal places`);
  }

  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

function withThousands(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatUnits(
  units: bigint,
  decimals: number,
  opts: { maxFrac?: number; minFrac?: number } = {},
): string {
  const { maxFrac = decimals, minFrac = 0 } = opts;
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;

  let fracText = frac.toString().padStart(decimals, "0").slice(0, maxFrac);
  while (fracText.length > minFrac && fracText.endsWith("0")) {
    fracText = fracText.slice(0, -1);
  }

  return `${neg ? "-" : ""}${withThousands(whole.toString())}${fracText ? `.${fracText}` : ""}`;
}

export function formatSol(lamports: bigint, maxFrac = 4): string {
  return formatUnits(lamports, SOL_DECIMALS, { maxFrac });
}

export function formatBps(bps: bigint, decimals = 2): string {
  const whole = bps / 100n;
  const frac = (bps % 100n).toString().padStart(2, "0").slice(0, decimals);
  return `${whole.toString()}${decimals > 0 ? `.${frac}` : ""}%`;
}
