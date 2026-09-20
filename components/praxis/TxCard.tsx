import { IconArrowRight, IconCheck } from "@tabler/icons-react";
import { Fragment, type ReactNode } from "react";

import { Button } from "@/components/praxis/Button";
import { Eyebrow } from "@/components/praxis/Eyebrow";

export type TxFlow = {
  label: string;
  /** Main display text — an amount string ("100.00") or a label ("savings"). */
  primary: string;
  /** Optional suffix in --text-tertiary, used for the amount + unit case. */
  unit?: string;
  sub: string;
  /** Switches the primary text from 36px to 28px (for name-style entries). */
  compact?: boolean;
};

export type TxMetaRow = {
  label: string;
  value: ReactNode;
  ok?: boolean;
  mono?: boolean;
};

export type TxStatus = {
  label: string;
  /**
   * The tone of the whole pill, not just its dot. A blocked card that keeps
   * the accent tint reads as "awaiting signature" at a glance — which is the
   * opposite of what happened.
   */
  tone?: "accent" | "success" | "danger";
};

const STATUS_TONE: Record<
  NonNullable<TxStatus["tone"]>,
  { color: string; tint: string }
> = {
  accent: { color: "var(--accent)", tint: "var(--accent-dim)" },
  success: { color: "var(--success)", tint: "rgba(127,176,105,0.14)" },
  danger: { color: "var(--danger)", tint: "rgba(199,91,91,0.16)" },
};

export type TxAction = {
  label: string;
  variant?: "primary" | "default";
  icon?: ReactNode;
};

const DEFAULT_ACTIONS: TxAction[] = [
  {
    label: "Confirm & sign",
    variant: "primary",
    icon: <IconArrowRight size={14} />,
  },
  { label: "Edit" },
  { label: "Cancel" },
];

type TxCardProps = {
  status?: TxStatus;
  from: TxFlow;
  to: TxFlow;
  meta?: TxMetaRow[];
  /**
   * The Aegis verdict, rendered between the simulation meta and the actions —
   * the same slot `PolicyCheckBanner` occupies in the real proposal card. A
   * transaction preview without it shows the product's least interesting half.
   */
  verdict?: ReactNode;
  actions?: TxAction[];
  /**
   * Replaces the action row once there is nothing left to decide — the real
   * proposal card swaps its buttons for the settled signature rather than
   * stacking a receipt underneath them.
   */
  footer?: ReactNode;
  className?: string;
};

export function TxCard({
  status,
  from,
  to,
  meta = [],
  verdict,
  actions = DEFAULT_ACTIONS,
  footer,
  className,
}: TxCardProps) {
  const base =
    "mt-2 rounded-xl bg-[var(--bg)] px-5 py-[18px] [border:0.5px_solid_var(--border-strong)]";
  const tone = STATUS_TONE[status?.tone ?? "accent"];

  return (
    <div className={className ? `${base} ${className}` : base}>
      {status && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <Eyebrow>Transaction preview</Eyebrow>
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 [font-family:var(--font-mono)] text-[10px] tracking-[0.08em] uppercase"
            style={{ background: tone.tint, color: tone.color }}
          >
            <span
              aria-hidden
              className="h-[5px] w-[5px] rounded-full"
              style={{ background: tone.color }}
            />
            {status.label}
          </span>
        </div>
      )}

      <div className="mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-5 pb-4 [border-bottom:0.5px_solid_var(--border)] max-[960px]:grid-cols-1 max-[960px]:justify-items-start max-[960px]:gap-[14px]">
        <TxFlowCol flow={from} />
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)] max-[960px]:rotate-90">
          <IconArrowRight size={16} />
        </div>
        <TxFlowCol flow={to} />
      </div>

      {meta.length > 0 && (
        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13px]">
          {meta.map((row) => (
            <Fragment key={row.label}>
              <dt className="[font-family:var(--font-mono)] text-[12px] text-[var(--text-tertiary)]">
                {row.label}
              </dt>
              <dd
                className={[
                  row.ok
                    ? "text-[var(--success)]"
                    : "text-[var(--text-primary)]",
                  row.mono ? "[font-family:var(--font-mono)] text-[12px]" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {row.ok && (
                  <IconCheck
                    size={14}
                    className="inline"
                    style={{ verticalAlign: -2 }}
                  />
                )}{" "}
                {row.value}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}

      {verdict && <div className="mb-4">{verdict}</div>}

      {footer}

      {!footer && actions.length > 0 && (
        <div className="flex gap-2.5">
          {actions.map((action) => (
            <Button
              key={action.label}
              variant={action.variant}
              className="flex-1 justify-center px-3.5 py-[9px]"
            >
              {action.label}
              {action.icon}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function TxFlowCol({ flow }: { flow: TxFlow }) {
  const sizeClass = flow.compact ? "text-[24px]" : "text-[30px]";
  return (
    <div>
      <div className="mb-1.5 [font-family:var(--font-mono)] text-[10px] tracking-[0.12em] text-[var(--text-tertiary)] uppercase">
        {flow.label}
      </div>
      <div
        className={`[font-family:var(--font-serif)] ${sizeClass} leading-none tracking-[-0.02em]`}
      >
        {flow.primary}
        {flow.unit && (
          <>
            {" "}
            <span className="text-[19px] text-[var(--text-tertiary)]">
              {flow.unit}
            </span>
          </>
        )}
      </div>
      <div className="mt-1.5 [font-family:var(--font-mono)] text-[12px] text-[var(--text-tertiary)]">
        {flow.sub}
      </div>
    </div>
  );
}
