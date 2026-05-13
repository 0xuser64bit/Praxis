import { IconCheck, IconExternalLink } from "@tabler/icons-react";
import type { ReactNode } from "react";

type ReceiptProps = {
  /** Body line — supports rich JSX so amounts/tokens can be bolded. */
  children: ReactNode;
  /** Hash, confirmation timing, slot — small mono caption under the body. */
  meta?: string;
};

export function Receipt({ children, meta }: ReceiptProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-[var(--bg-elevated)] px-3.5 py-3 [border:0.5px_solid_var(--border)]">
      <span
        aria-hidden
        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[var(--success)]"
        style={{ background: "rgba(127, 176, 105, 0.12)" }}
      >
        <IconCheck size={13} />
      </span>
      <div className="flex-1 text-[13px] [&_strong]:font-medium">
        {children}
        {meta && (
          <div className="mt-1 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
            {meta}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Open in explorer"
        className="cursor-pointer text-[var(--text-tertiary)]"
      >
        <IconExternalLink size={14} />
      </button>
    </div>
  );
}
