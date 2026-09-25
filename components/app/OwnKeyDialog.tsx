"use client";

import { IconKey, IconX } from "@tabler/icons-react";
import { useId, useState } from "react";

import {
  loadOwnKey,
  OWN_PROVIDERS,
  ownProvider,
  parseOwnKeyDraft,
  removeOwnKey,
  saveOwnKey,
  useOwnKey,
  type OwnProviderId,
} from "./lib/ownKey";
import { Modal } from "./ui";

/**
 * Where the owner puts a key, looks at it, and takes it back.
 *
 * The suggestion can be closed. This cannot be the only copy of the promise:
 * after the bar is gone, the header still opens this, and the key is still
 * only in local storage.
 */
export function OwnKeyDialog({ onClose }: { onClose: () => void }) {
  const own = useOwnKey();
  const titleId = useId();
  const bodyId = useId();
  const stored = own.provider ? ownProvider(own.provider) : null;
  const [replacing, setReplacing] = useState(false);
  const [provider, setProvider] = useState<OwnProviderId>(own.provider ?? "gemini");
  const [secret, setSecret] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showForm = !stored || replacing;
  const choice = ownProvider(provider);

  const save = () => {
    const draft = parseOwnKeyDraft(provider, secret);
    if (!draft.ok) {
      setError(draft.reason);
      return;
    }
    try {
      saveOwnKey(draft.key);
      setSecret("");
      setRevealed(null);
      setReplacing(false);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't store the key.");
    }
  };

  const reveal = () => {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    setRevealed(loadOwnKey()?.secret ?? null);
  };

  return (
    <Modal onDismiss={onClose} labelledBy={titleId} describedBy={bodyId}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--accent)]"
            style={{ background: "rgba(201, 160, 93, 0.16)" }}
          >
            <IconKey size={18} />
          </span>
          <h2
            id={titleId}
            className="[font-family:var(--font-serif)] text-[22px] leading-[1.15] tracking-[-0.01em]"
          >
            Your model key
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          autoFocus={!showForm}
          aria-label="Close"
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <IconX size={15} />
        </button>
      </div>

      <p id={bodyId} className="mt-4 text-[13px] leading-[1.55] text-[var(--text-secondary)]">
        The key is saved in this browser&apos;s local storage. Sending a message calls the model
        from this page. Praxis receives the model&apos;s reading, and does not receive or store the key.
        Remove it whenever you want.
      </p>

      {stored && !showForm && (
        <div className="mt-4 rounded-xl bg-[var(--bg)] px-3.5 py-3 [border:0.5px_solid_var(--border)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-medium text-[var(--text-primary)]">{stored.label}</div>
              <div className="mt-0.5 [font-family:var(--font-mono)] text-[12px] text-[var(--text-secondary)]">
                ••••{own.last4}
              </div>
            </div>
            <button
              type="button"
              onClick={reveal}
              className="cursor-pointer text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {revealed !== null ? "Hide" : "Show"}
            </button>
          </div>
          {revealed !== null && (
            <p className="mt-2 break-all [font-family:var(--font-mono)] text-[12px] leading-[1.45] text-[var(--text-primary)]">
              {revealed}
            </p>
          )}
          <p className="mt-2 [font-family:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]">
            Calls {stored.model}
          </p>
          <p className="mt-1.5 text-[12px] leading-[1.45] text-[var(--text-tertiary)]">
            Saved in this browser&apos;s local storage.
          </p>
          {own.problem && (
            <p className="mt-2 text-[12.5px] leading-[1.45] text-[var(--warning)]" role="status">
              {own.problem}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                removeOwnKey();
                setRevealed(null);
                setReplacing(false);
                setError(null);
              }}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-md px-3 text-[12px] font-medium text-[var(--danger)] [border:0.5px_solid_rgba(199,91,91,0.4)] hover:bg-[rgba(199,91,91,0.1)]"
            >
              Remove key
            </button>
            <button
              type="button"
              onClick={() => {
                setProvider(stored.id);
                setReplacing(true);
                setError(null);
                setRevealed(null);
              }}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-md px-3 text-[12px] text-[var(--text-secondary)] [border:0.5px_solid_var(--border-strong)] hover:text-[var(--text-primary)] hover:[border-color:var(--border-bright)]"
            >
              Replace
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="flex gap-1.5">
            {OWN_PROVIDERS.map((option) => {
              const selected = option.id === provider;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setProvider(option.id)}
                  className={`h-8 flex-1 cursor-pointer rounded-md text-[12.5px] font-medium [border:0.5px_solid] [transition:background_0.15s,color_0.15s,border-color_0.15s] ${
                    selected
                      ? "bg-[var(--accent)] text-[var(--bg)] [border-color:var(--accent)]"
                      : "bg-[var(--bg)] text-[var(--text-secondary)] [border-color:var(--border)] hover:[border-color:var(--border-strong)]"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <label className="mt-3 block">
            <span className="[font-family:var(--font-mono)] text-[10px] tracking-[0.14em] text-[var(--text-tertiary)] uppercase">
              {choice.label} key
            </span>
            <input
              value={secret}
              onChange={(event) => {
                setSecret(event.target.value);
                setError(null);
              }}
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Paste your key"
              aria-label={`${choice.label} API key`}
              autoFocus
              className="mt-1.5 w-full rounded-lg bg-[var(--bg)] px-3 py-2 [font-family:var(--font-mono)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] [border:0.5px_solid_var(--border-strong)] focus:[border-color:var(--accent)] max-[760px]:text-[16px]"
            />
          </label>

          <p className="mt-2 text-[12px] leading-[1.45] text-[var(--text-tertiary)]">
            Calls{" "}
            <span className="[font-family:var(--font-mono)] text-[11px]">{choice.model}</span>
            .{" "}
            <a
              href={choice.createUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[var(--text-secondary)] underline decoration-[var(--border-strong)] underline-offset-2 hover:text-[var(--text-primary)]"
            >
              {choice.createLabel}
            </a>
          </p>

          {error && (
            <p className="mt-2 text-[12.5px] leading-[1.45] text-[var(--danger)]" role="alert">
              {error}
            </p>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            {replacing && (
              <button
                type="button"
                onClick={() => {
                  setReplacing(false);
                  setSecret("");
                  setError(null);
                }}
                className="inline-flex h-8 cursor-pointer items-center rounded-md px-3 text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="inline-flex h-8 cursor-pointer items-center rounded-md bg-[var(--text-primary)] px-3 text-[12.5px] font-medium text-[var(--bg)] [transition:background_0.15s] hover:bg-[var(--accent)]"
            >
              {stored ? "Save key" : "Save in this browser"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
