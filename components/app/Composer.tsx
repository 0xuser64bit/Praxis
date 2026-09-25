"use client";

import { IconArrowRight } from "@tabler/icons-react";
import { useState } from "react";

import { SurfaceBand } from "./ui";

/**
 * First-run prompts. Three of these used to be swaps — which are always
 * blocked — so a new user's most likely first three actions all dead-ended,
 * and one named a token that does not exist in any configured universe. Lead
 * with the flows that work end-to-end and keep exactly one blocked example,
 * because the chain saying no is the point of the product.
 */
const SUGGESTIONS = [
  "send 0.5 SOL to maya",
  "what's bonk doing this week",
  "how does my policy keep me safe",
  "swap 100 usdc into JUP",
];

/**
 * The draft is controlled by the conversation: it is cleared only once a send
 * of that text succeeds, whichever control sent it, so a failed message stays
 * editable and a successful retry cannot leave a stale copy behind.
 */
export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  showSuggestions,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
  showSuggestions?: boolean;
}) {
  const [sending, setSending] = useState(false);
  const busy = Boolean(disabled || sending);

  const submit = async () => {
    const text = value.trim();
    if (!text || busy) return;
    setSending(true);
    try {
      await onSend(text);
    } finally {
      setSending(false);
    }
  };

  return (
    <SurfaceBand className="bg-[var(--bg-elevated)] pt-3.5 pb-4 [border-top:0.5px_solid_var(--border)]">
      {showSuggestions && (
        <div className="mb-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => {
                if (!busy) void onSend(s);
              }}
              className="min-h-9 cursor-pointer rounded-full bg-[var(--bg-card)] px-3 py-1.5 [font-family:var(--font-mono)] text-[11.5px] text-[var(--text-secondary)] [border:0.5px_solid_var(--border-strong)] [transition:border-color_0.15s,color_0.15s] hover:[border-color:var(--border-bright)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 max-[760px]:min-h-11"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div
        className={`flex items-center gap-2.5 rounded-lg bg-[var(--bg-card)] px-3.5 py-2.5 [border:0.5px_solid_var(--border-strong)] [transition:border-color_0.15s] focus-within:[border-color:var(--accent)] ${
          busy ? "opacity-60" : ""
        }`}
      >
        <span aria-hidden="true" className="[font-family:var(--font-mono)] text-[var(--accent)]">›</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={busy}
          maxLength={2000}
          // Not "thinking…": the indicator above stops saying that past twelve
          // seconds, and a placeholder that disagrees with it reads as a stall.
          placeholder={busy ? "Praxis is working…" : "Tell Praxis what to do…"}
          aria-label="Message Praxis"
          className="min-w-0 flex-1 bg-transparent [font-family:var(--font-mono)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] max-[760px]:text-[16px]"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !value.trim()}
          aria-label="Send"
          aria-busy={sending}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[var(--text-primary)] text-[var(--bg)] [transition:background_0.15s] hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:bg-[var(--bg-elevated)] disabled:text-[var(--text-tertiary)]"
        >
          <IconArrowRight size={15} />
        </button>
      </div>

      {/* The two labels collide below ~420px, where the left one wraps under
          the right one. Drop the decorative label rather than let them
          overlap. */}
      <div className="mt-2.5 flex items-center justify-between gap-3 [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
        <span className="min-w-0">
          ↵ to send · <span className="max-[420px]:hidden">every action is policy-checked before you sign</span>
          <span className="hidden max-[420px]:inline">policy-checked before you sign</span>
        </span>
        <span className="shrink-0 max-[520px]:hidden">structured intent</span>
      </div>
    </SurfaceBand>
  );
}
