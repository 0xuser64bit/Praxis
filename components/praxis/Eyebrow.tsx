import type { ReactNode } from "react";

type EyebrowProps = {
  children: ReactNode;
  accent?: boolean;
  className?: string;
};

export function Eyebrow({ children, accent = false, className }: EyebrowProps) {
  const base =
    "[font-family:var(--font-mono)] text-[11px] font-normal uppercase tracking-[0.18em]";
  const color = accent ? "text-[var(--accent)]" : "text-[var(--text-tertiary)]";
  const merged = [base, color, className].filter(Boolean).join(" ");
  return <span className={merged}>{children}</span>;
}
