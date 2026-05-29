"use client";

/**
 * A clarifying question with tappable options. Praxis asks rather than guesses
 * when a name is ambiguous or unknown (spec §12.ii) — one extra question beats
 * one wrong transaction.
 */

import type { ClarifyOption } from "@praxis/shared";
import { IconArrowRight } from "@tabler/icons-react";

import { renderRich } from "./richtext";

export function ClarifyPrompt({
  text,
  options,
  onChoose,
  disabled,
}: {
  text: string;
  options: ClarifyOption[];
  onChoose: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="text-[14px] leading-[1.6] text-[var(--text-secondary)]">
      <p>{renderRich(text)}</p>
      <div className="mt-3 flex flex-col gap-2">
        {options.map((opt) => (
          <button
            key={opt.label + opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChoose(opt.value)}
            className="group flex items-center justify-between gap-3 rounded-lg bg-[var(--bg)] px-3.5 py-2.5 text-left [border:0.5px_solid_var(--border-strong)] [transition:border-color_0.15s,background_0.15s] hover:[border-color:var(--border-bright)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="min-w-0">
              <span className="block text-[14px] font-medium text-[var(--text-primary)]">
                {opt.label}
              </span>
              {opt.hint && (
                <span className="block truncate [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
                  {opt.hint}
                </span>
              )}
            </span>
            <IconArrowRight
              size={15}
              className="shrink-0 text-[var(--text-tertiary)] [transition:color_0.15s,transform_0.15s] group-hover:translate-x-0.5 group-hover:text-[var(--accent)]"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
