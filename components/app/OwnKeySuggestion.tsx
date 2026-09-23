"use client";

import { IconKey, IconX } from "@tabler/icons-react";

import { ownProvider, useOwnKey, dismissOwnKeySuggestion } from "./lib/ownKey";

/**
 * A suggestion that stays put until the owner closes it.
 *
 * It is not a toast: toasts leave on their own, and this one is about where
 * a credential lives. Closing it remembers the choice in this browser. The
 * key itself, if they added one, stays until they remove it from the header.
 */
export function OwnKeySuggestion({ onManage }: { onManage: () => void }) {
  const own = useOwnKey();
  if (own.dismissed) return null;

  const choice = own.provider ? ownProvider(own.provider) : null;

  return (
    <section
      aria-label="Suggestion to use your own model key"
      className="shrink-0 px-6 py-3 [border-bottom:0.5px_solid_rgba(201,160,93,0.28)] max-[760px]:px-4"
      style={{ background: "var(--accent-dim)" }}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--accent)]"
          style={{ background: "rgba(201, 160, 93, 0.16)" }}
        >
          <IconKey size={15} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="[font-family:var(--font-mono)] text-[10px] tracking-[0.14em] text-[var(--accent)] uppercase">
            {choice ? "Your key" : "Shared model"}
          </div>
          <p className="mt-1 text-[13px] leading-[1.55] text-[var(--text-secondary)]">
            {choice ? (
              <>
                This browser calls {choice.label} with your key, on your quota, using{" "}
                <span className="[font-family:var(--font-mono)] text-[12px] text-[var(--text-primary)]">
                  {choice.model}
                </span>
                . The key stays in local storage on this device. Praxis receives only the model&apos;s
                reading, and removing the key sends the next message back to the shared model.
              </>
            ) : (
              <>
                Praxis reads messages on a shared free-tier model, so a spent quota falls through to a
                weaker parser. Add a Gemini or Groq key and this browser calls the model on your quota.
                The key stays in this browser. Praxis receives only the model&apos;s reading, and you can
                remove the key whenever you want.
              </>
            )}
          </p>
          {own.problem && (
            <p className="mt-1.5 text-[12.5px] leading-[1.5] text-[var(--warning)]" role="status">
              {own.problem} The last message used the shared parser.
            </p>
          )}
          <button
            type="button"
            onClick={onManage}
            className="mt-2.5 inline-flex h-7 cursor-pointer items-center rounded-md bg-[var(--bg-card)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] [border:0.5px_solid_var(--border-strong)] [transition:border-color_0.15s] hover:[border-color:var(--border-bright)]"
          >
            {choice ? "Manage key" : "Add a key"}
          </button>
        </div>

        <button
          type="button"
          onClick={dismissOwnKeySuggestion}
          aria-label="Dismiss suggestion"
          title="Dismiss suggestion"
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--text-tertiary)] [transition:color_0.15s,background_0.15s] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
        >
          <IconX size={14} />
        </button>
      </div>
    </section>
  );
}
