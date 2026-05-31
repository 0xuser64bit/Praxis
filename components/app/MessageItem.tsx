"use client";

import type { Message } from "@praxis/shared";

import { ClarifyPrompt } from "./ClarifyPrompt";
import { PolicyChangeCard } from "./PolicyChangeCard";
import { ProposalCard } from "./ProposalCard";
import { ResearchCard } from "./ResearchCard";
import { renderRich } from "./richtext";

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MessageItem({
  message,
  onSend,
  onOpenPolicy,
}: {
  message: Message;
  onSend: (text: string) => void;
  onOpenPolicy: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="mb-6">
        <div className="mb-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
          You · {formatTime(message.ts)}
        </div>
        <div className="flex items-start gap-3 [font-family:var(--font-mono)] text-[14px]">
          <span className="text-[var(--accent)]">›</span>
          <span className="text-[var(--text-primary)]">{message.text}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-7">
      <div className="mb-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
        Praxis · {formatTime(message.ts)}
      </div>
      <div className="text-[14px] leading-[1.6] text-[var(--text-secondary)]">
        {message.blocks.map((block, i) => {
          switch (block.type) {
            case "prose":
              return (
                <p key={i} className="mb-0">
                  {renderRich(block.text)}
                </p>
              );
            case "clarify":
              return (
                <ClarifyPrompt
                  key={i}
                  text={block.text}
                  options={block.options}
                  onChoose={onSend}
                />
              );
            case "proposal":
              return (
                <div key={i}>
                  <p className="mb-1">{renderRich(block.text)}</p>
                  <ProposalCard proposalId={block.proposalId} onOpenPolicy={onOpenPolicy} />
                </div>
              );
            case "research":
              return (
                <div key={i}>
                  <p className="mb-1">{renderRich(block.text)}</p>
                  <ResearchCard data={block.data} />
                </div>
              );
            case "notice":
              return (
                <div
                  key={i}
                  className={`mt-1 rounded-lg px-3 py-2 text-[13px] leading-[1.45] [border:0.5px_solid_var(--border)] ${
                    block.tone === "success"
                      ? "bg-[rgba(91,160,110,0.10)] text-[var(--success,#5BA06E)]"
                      : "bg-[var(--surface-2)] text-[var(--text-secondary)]"
                  }`}
                >
                  {block.text}
                </div>
              );
            case "policy_change":
              return (
                <div key={i}>
                  <p className="mb-1">{renderRich(block.text)}</p>
                  <PolicyChangeCard
                    patch={block.patch}
                    changes={block.changes}
                    applied={block.applied}
                  />
                </div>
              );
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}
