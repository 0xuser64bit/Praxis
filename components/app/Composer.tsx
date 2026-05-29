"use client";

import { IconArrowRight } from "@tabler/icons-react";
import { useState } from "react";

const SUGGESTIONS = [
  "send 0.5 sol to maya",
  "send 50 sol to maya",
  "send 1 sol to alex",
  "swap 100 usdc into $SAFEMOON",
  "what's bonk doing this week",
];

export function Composer({
  onSend,
  disabled,
  showSuggestions,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  showSuggestions?: boolean;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  };

  return (
    <div className="bg-[var(--bg-elevated)] px-6 pt-3.5 pb-4 [border-top:0.5px_solid_var(--border)]">
      {showSuggestions && (
        <div className="mb-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (!disabled) onSend(s);
              }}
              className="cursor-pointer rounded-full bg-[var(--bg-card)] px-3 py-1.5 [font-family:var(--font-mono)] text-[11.5px] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)] [transition:border-color_0.15s,color_0.15s] hover:[border-color:var(--border-bright)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div
        className={`flex items-center gap-2.5 rounded-lg bg-[var(--bg-card)] px-3.5 py-2.5 [border:0.5px_solid_var(--border-strong)] [transition:border-color_0.15s] focus-within:[border-color:var(--border-bright)] ${
          disabled ? "opacity-60" : ""
        }`}
      >
        <span className="[font-family:var(--font-mono)] text-[var(--accent)]">›</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={disabled}
          placeholder={disabled ? "Praxis is thinking…" : "Tell Praxis what to do…"}
          aria-label="Message Praxis"
          className="flex-1 bg-transparent [font-family:var(--font-mono)] text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          aria-label="Send"
          className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--text-primary)] text-[var(--bg)] [transition:background_0.15s] hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:bg-[var(--bg-elevated)] disabled:text-[var(--text-tertiary)]"
        >
          <IconArrowRight size={15} />
        </button>
      </div>

      <div className="mt-2.5 flex items-center justify-between [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
        <span>↵ to send · every action is policy-checked before you sign</span>
        <span>claude-sonnet-4.6</span>
      </div>
    </div>
  );
}
