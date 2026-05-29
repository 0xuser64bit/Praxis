"use client";

import { useEffect, useRef } from "react";

import { Composer } from "./Composer";
import { MessageItem } from "./MessageItem";
import { useProvider, useThinking, useThread } from "./ProviderContext";

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
  const bottomRef = useRef<HTMLDivElement>(null);

  const messageCount = thread?.messages.length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messageCount, thinking]);

  if (!thread) return null;

  const onSend = (text: string) => {
    void provider.send(threadId, text).catch(() => undefined);
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

      <Composer onSend={onSend} disabled={thinking} showSuggestions={messageCount <= 1} />
    </div>
  );
}

function Thinking() {
  return (
    <div className="mb-7">
      <div className="mb-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
        Praxis
      </div>
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)] [animation:pulse_1.2s_infinite]"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
    </div>
  );
}
