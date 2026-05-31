"use client";

import { useEffect, useRef, useState } from "react";

import { Composer } from "./Composer";
import { MessageItem } from "./MessageItem";
import { useProvider, useThinking, useThread } from "./ProviderContext";
import { useToast } from "./Toast";

export function Conversation({
  threadId,
  onOpenPolicy,
}: {
  threadId: string;
  onOpenPolicy: () => void;
}) {
  const provider = useProvider();
  const thread = useThread(threadId);
  const thinking = useThinking(threadId);
  const { toast } = useToast();
  const toasted = useRef<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messageCount = thread?.messages.length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messageCount, thinking]);

  // Surface a toast when a new agent reply carries a notice block (e.g. a saved
  // contact). Deduped by message id so re-renders don't re-fire.
  useEffect(() => {
    if (!thread) return;
    for (const m of thread.messages) {
      if (m.role !== "agent" || toasted.current.has(m.id)) continue;
      const notice = m.blocks.find((b) => b.type === "notice");
      if (notice && notice.type === "notice") {
        toasted.current.add(m.id);
        toast(notice.text, notice.tone);
      }
    }
  }, [thread, toast]);

  if (!thread) return null;

  const onSend = (text: string) => {
    setError(null);
    void provider.send(threadId, text).catch((err) => {
      setError(messageFromError(err, "Message failed."));
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-w-0 flex-1 overflow-y-auto px-8 py-7 max-[760px]:px-5">
        <div className="mx-auto max-w-[680px]">
          {thread.messages.length === 0 && (
            <div className="mt-10 text-center text-[14px] text-[var(--text-tertiary)]">
              New session. Type an instruction below to begin.
            </div>
          )}
          {thread.messages.map((m) => (
            <MessageItem key={m.id} message={m} onSend={onSend} onOpenPolicy={onOpenPolicy} />
          ))}
          {thinking && <Thinking />}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && (
        <div className="mx-6 mb-3 rounded-lg bg-[rgba(199,91,91,0.10)] px-3 py-2 text-[12px] leading-[1.45] text-[var(--danger)] [border:0.5px_solid_rgba(199,91,91,0.28)]">
          {error}
        </div>
      )}
      <Composer onSend={onSend} disabled={thinking} showSuggestions={messageCount <= 1} />
    </div>
  );
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function Thinking() {
  return (
    <div className="mb-7">
      <div className="mb-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
        Praxis
      </div>
      <div className="inline-flex items-center gap-2.5 rounded-lg bg-[var(--bg-card)] px-3 py-2 [border:0.5px_solid_var(--border)]">
        <span className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] [animation:thinkingDot_1.2s_ease-in-out_infinite]"
              style={{ animationDelay: `${i * 0.16}s` }}
            />
          ))}
        </span>
        <span className="[font-family:var(--font-mono)] text-[11.5px] text-[var(--text-secondary)]">
          thinking…
        </span>
      </div>
    </div>
  );
}
