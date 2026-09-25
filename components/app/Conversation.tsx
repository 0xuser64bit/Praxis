"use client";

import { IconPlus } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Composer } from "./Composer";
import { MessageItem } from "./MessageItem";
import { Thinking } from "./Thinking";
import { useProvider, useThinking, useThread } from "./ProviderContext";
import { Surface, SurfaceBand } from "./ui";
import { useToast } from "./Toast";
import { messageFromError } from "./lib/useAsyncAction";

type SendError = { text: string; message: string };

export function Conversation({
  threadId,
  onOpenPolicy,
  onNewThread,
}: {
  threadId: string | null;
  onOpenPolicy: () => void;
  onNewThread: () => void;
}) {
  const provider = useProvider();
  const thread = useThread(threadId ?? "");
  const thinking = useThinking(threadId ?? "");
  const { toast } = useToast();
  // Ids seen for the currently baselined thread. A thread's history is
  // snapshotted silently the first time we see it in this mount — only
  // messages that arrive AFTER that baseline get a toast. Otherwise every
  // view switch (which remounts this component) replays all historical
  // notices as popups.
  const seen = useRef<{ threadId: string; ids: Set<string> } | null>(null);
  const [error, setError] = useState<SendError | null>(null);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const messageCount = thread?.messages.length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "end",
    });
  }, [messageCount, thinking]);

  // Surface a toast when a new agent reply carries a notice block (e.g. a saved
  // contact). Only messages that arrive after the thread's baseline toast —
  // history never re-fires, no matter how often this view remounts.
  useEffect(() => {
    if (!thread) return;
    const current = seen.current;
    if (!current || current.threadId !== thread.id) {
      seen.current = { threadId: thread.id, ids: new Set(thread.messages.map((m) => m.id)) };
      return;
    }
    for (const m of thread.messages) {
      if (m.role !== "agent" || current.ids.has(m.id)) continue;
      current.ids.add(m.id);
      const notice = m.blocks.find((b) => b.type === "notice");
      if (notice && notice.type === "notice") {
        toast(notice.text, notice.tone);
      }
    }
  }, [thread, toast]);

  if (!thread) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 py-7 text-center">
        <p className="text-[15px] text-[var(--text-primary)]">Start a new session</p>
        <p className="max-w-[36ch] text-[13px] leading-[1.5] text-[var(--text-tertiary)]">
          Your conversation history is empty. Start a session to send your first instruction.
        </p>
        <button
          type="button"
          onClick={onNewThread}
          className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--bg)]"
        >
          <IconPlus size={15} />
          New session
        </button>
      </div>
    );
  }

  // Every send path (composer, retry, clarify and suggestion chips) lands here.
  // A failure leaves the draft alone so the text can be edited and resent; a
  // success clears it only if the draft is the text that just went out.
  const onSend = async (text: string): Promise<void> => {
    setError(null);
    try {
      await provider.send(thread.id, text);
      setDraft((current) => (current.trim() === text ? "" : current));
    } catch (err) {
      setError({ text, message: messageFromError(err, "Message failed.") });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Surface>
        {thread.messages.length === 0 && (
          <div className="mt-10 text-center text-[14px] text-[var(--text-tertiary)]">
            New session. Type an instruction below to begin.
          </div>
        )}
        <div role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
          {thread.messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              onSend={onSend}
              onOpenPolicy={onOpenPolicy}
              disabled={thinking}
            />
          ))}
        </div>
        {thinking && <Thinking />}
        <div ref={bottomRef} />
      </Surface>

      {error && (
        <SurfaceBand className="mb-3">
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-lg bg-[rgba(199,91,91,0.10)] px-3 py-2 text-[12px] leading-[1.45] text-[var(--danger)] [border:0.5px_solid_rgba(199,91,91,0.28)]"
          >
            <span>{error.message}</span>
            <button
              type="button"
              disabled={thinking}
              onClick={() => void onSend(error.text)}
              className="min-h-9 shrink-0 rounded-md px-2.5 text-[11px] font-medium text-[var(--danger)] [border:0.5px_solid_rgba(199,91,91,0.35)] hover:bg-[rgba(199,91,91,0.12)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Retry
            </button>
          </div>
        </SurfaceBand>
      )}
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={onSend}
        disabled={thinking}
        showSuggestions={messageCount <= 1}
      />
    </div>
  );
}
