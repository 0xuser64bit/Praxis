import { IconArrowRight, IconCheck } from "@tabler/icons-react";
import { Fragment, type ReactNode } from "react";

import { Button } from "@/components/praxis/Button";
import { Eyebrow } from "@/components/praxis/Eyebrow";

export type TxFlow = {
  label: string;
  amount: string;
  unit: string;
  sub: string;
};

export type TxMetaRow = {
  label: string;
  value: ReactNode;
  ok?: boolean;
  mono?: boolean;
};

export type TxStatus = {
  label: string;
  /** CSS color value for the leading dot. Defaults to var(--accent). */
  dotColor?: string;
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
  actions?: TxAction[];
  className?: string;
};

export function TxCard({
  status,
  from,
  to,
  meta = [],
  actions = DEFAULT_ACTIONS,
  className,
}: TxCardProps) {
  const base =
    "mt-2 rounded-xl bg-[var(--bg)] px-6 py-[22px] [border:0.5px_solid_var(--border-strong)]";

  return (
    <div className={className ? `${base} ${className}` : base}>
      {status && (
        <div className="mb-[22px] flex items-center justify-between">
          <Eyebrow>Transaction preview</Eyebrow>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-dim)] px-2.5 py-1 [font-family:var(--font-mono)] text-[10px] tracking-[0.08em] text-[var(--accent)] uppercase">
            <span
              aria-hidden
              className="h-[5px] w-[5px] rounded-full"
              style={{ background: status.dotColor ?? "var(--accent)" }}
            />
            {status.label}
          </span>
        </div>
      )}

      <div className="mb-[18px] grid grid-cols-[1fr_auto_1fr] items-center gap-5 pb-[22px] [border-bottom:0.5px_solid_var(--border)]">
        <TxFlowCol flow={from} />
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)]">
          <IconArrowRight size={16} />
        </div>
        <TxFlowCol flow={to} />
      </div>

      {meta.length > 0 && (
        <dl className="mb-[22px] grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
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

      {actions.length > 0 && (
        <div className="flex gap-2.5">
          {actions.map((action) => (
            <Button
              key={action.label}
              variant={action.variant}
              className="flex-1 justify-center px-3.5 py-[11px]"
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
  return (
    <div>
      <div className="mb-1.5 [font-family:var(--font-mono)] text-[10px] tracking-[0.12em] text-[var(--text-tertiary)] uppercase">
        {flow.label}
      </div>
      <div className="[font-family:var(--font-serif)] text-[36px] leading-none tracking-[-0.02em]">
        {flow.amount}{" "}
        <span className="text-[22px] text-[var(--text-tertiary)]">
          {flow.unit}
        </span>
      </div>
      <div className="mt-1.5 [font-family:var(--font-mono)] text-[12px] text-[var(--text-tertiary)]">
        {flow.sub}
      </div>
    </div>
  );
}
