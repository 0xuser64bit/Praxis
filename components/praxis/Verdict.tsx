import { IconShieldCheck, IconShieldX } from "@tabler/icons-react";
import type { ReactNode } from "react";

/**
 * The Aegis verdict, as the product renders it.
 *
 * A marketing copy of `components/app/PolicyCheckBanner` — same shape, same
 * wording, same weight given to a rejection as to an approval. The chain
 * saying no is the pitch, so it is not allowed to look like an error state
 * that got past us.
 */
export function Verdict({
  allowed,
  detail,
  meter,
  reasonCode,
}: {
  allowed: boolean;
  /** Headroom line when allowed; the on-chain reason when not. */
  detail: ReactNode;
  /** `{ spent, amount }` as fractions of the daily cap, 0–1. */
  meter?: { spent: number; amount: number };
  /** The Aegis `RejectReason` label, shown verbatim when rejected. */
  reasonCode?: string;
}) {
  const accent = allowed ? "var(--success)" : "var(--danger)";

  return (
    <div
      className="rounded-xl px-4 py-3.5"
      style={{
        background: allowed ? "rgba(127, 176, 105, 0.09)" : "rgba(199, 91, 91, 0.10)",
        border: `0.5px solid ${allowed ? "rgba(127, 176, 105, 0.28)" : "rgba(199, 91, 91, 0.32)"}`,
      }}
      role="status"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
            style={{
              background: allowed ? "rgba(127,176,105,0.16)" : "rgba(199,91,91,0.18)",
              color: accent,
            }}
          >
            {allowed ? <IconShieldCheck size={16} /> : <IconShieldX size={16} />}
          </span>
          <div className="text-[14px] font-medium text-[var(--text-primary)]">
            {allowed ? "Within your Aegis policy" : "Blocked by Aegis"}
          </div>
        </div>
        <span
          className="shrink-0 [font-family:var(--font-mono)] text-[10px] tracking-[0.14em] uppercase"
          style={{ color: accent }}
        >
          {allowed ? "Allowed" : "Rejected"}
        </span>
      </div>

      <p className="mt-2 pl-[38px] text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
        {detail}
      </p>

      {meter && (
        <div className="mt-2.5 ml-[38px] flex h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
          <div className="flex h-full w-full overflow-hidden rounded-full">
            <span
              className="h-full bg-[var(--text-quaternary)]"
              style={{ width: `${clamp(meter.spent) * 100}%` }}
            />
            <span
              className="h-full"
              style={{ width: `${clamp(meter.amount) * 100}%`, background: accent }}
            />
          </div>
        </div>
      )}

      {reasonCode && (
        <div className="mt-2.5 pl-[38px] [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
          on-chain reason · {reasonCode}
        </div>
      )}
    </div>
  );
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
