"use client";

import { IconChevronDown, IconPlus } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { Thread } from "@praxis/shared";

/**
 * Thread switching and creation on small screens.
 *
 * The sidebar — which owns the thread list and the "New thread" button — is
 * hidden below 760px, and nothing replaced it: on a phone you could neither
 * start a session nor return to one, and were stuck in whichever thread
 * happened to be most recent. The mobile tab row only ever switched between
 * Conversation, Policy and Activity.
 *
 * Rendered by the mobile-only block in `AppShell`, and only in the
 * conversation view, so the extra row costs nothing on the screens that do
 * not need it.
 */
export function MobileThreadBar({
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
}: {
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const activeTitle = threads.find((thread) => thread.id === activeThreadId)?.title ?? "New session";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={root}
      className="relative flex items-center gap-1.5 px-4 pb-2"
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-thread-menu"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md bg-[var(--bg-card)] px-3 text-[13px] text-[var(--text-primary)] [border:0.5px_solid_var(--border-strong)] [transition:border-color_0.15s]"
      >
        <span className="truncate">{activeTitle}</span>
        <IconChevronDown
          size={14}
          className={`ml-auto shrink-0 text-[var(--text-tertiary)] [transition:transform_0.15s] ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>

      <button
        type="button"
        aria-label="New thread"
        onClick={() => {
          setOpen(false);
          onNewThread();
          trigger.current?.focus();
        }}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] [border:0.5px_solid_var(--border-strong)] [transition:background_0.15s,color_0.15s] hover:bg-[var(--bg-card)] hover:text-[var(--accent)]"
      >
        <IconPlus size={16} />
      </button>

      {open && (
        <div
          id="mobile-thread-menu"
          role="group"
          aria-label="Threads"
          className="absolute top-full right-4 left-4 z-20 mt-1 max-h-[50dvh] overflow-y-auto rounded-md bg-[var(--bg-elevated)] p-1 [border:0.5px_solid_var(--border-strong)]"
        >
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              aria-pressed={thread.id === activeThreadId}
              onClick={() => {
                setOpen(false);
                onSelectThread(thread.id);
                trigger.current?.focus();
              }}
              className={`block min-h-11 w-full truncate rounded px-2.5 py-2 text-left text-[13px] [transition:background_0.15s,color_0.15s] ${
                thread.id === activeThreadId
                  ? "bg-[var(--bg-card)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              {thread.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
