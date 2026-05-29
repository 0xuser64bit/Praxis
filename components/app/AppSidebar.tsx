"use client";

import type { PolicyView, Thread } from "@praxis/shared";
import {
  IconHistory,
  IconMessages,
  IconPlus,
  IconShieldLock,
} from "@tabler/icons-react";

import { Dot } from "./ui";
import { formatSol, shortenAddress } from "./lib/units";
import type { View } from "./AppShell";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export function AppSidebar({
  view,
  onView,
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  policy,
  rejectedCount,
}: {
  view: View;
  onView: (v: View) => void;
  threads: Thread[];
  activeThreadId: string;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  policy: PolicyView;
  rejectedCount: number;
}) {
  const revoked = policy.paused || policy.agentAuthority === SYSTEM_PROGRAM;
  const groups = groupThreads(threads);

  return (
    <aside className="flex w-[248px] shrink-0 flex-col bg-[var(--bg-elevated)] px-3.5 py-[18px] [border-right:0.5px_solid_var(--border)] max-[760px]:hidden">
      {/* brand */}
      <div className="mb-5 flex items-center gap-2 px-1.5 py-1">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-[var(--text-primary)] [font-family:var(--font-mono)] text-[12px] font-medium text-[var(--bg)]">
          P
        </span>
        <span className="[font-family:var(--font-serif)] text-[18px]">Praxis</span>
        <span className="ml-auto [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
          v0.1
        </span>
      </div>

      {/* primary nav */}
      <nav className="mb-5 flex flex-col gap-0.5">
        <NavItem
          icon={<IconMessages size={16} />}
          label="Conversation"
          active={view === "chat"}
          onClick={() => onView("chat")}
        />
        <NavItem
          icon={<IconShieldLock size={16} />}
          label="Policy"
          active={view === "policy"}
          onClick={() => onView("policy")}
          trailing={revoked ? <Dot color="var(--danger)" /> : <Dot color="var(--success)" />}
        />
        <NavItem
          icon={<IconHistory size={16} />}
          label="Activity"
          active={view === "activity"}
          onClick={() => onView("activity")}
          trailing={
            rejectedCount > 0 ? (
              <span className="rounded-full bg-[rgba(199,91,91,0.16)] px-1.5 py-px [font-family:var(--font-mono)] text-[10px] text-[var(--danger)]">
                {rejectedCount}
              </span>
            ) : undefined
          }
        />
      </nav>

      {/* new thread */}
      <button
        type="button"
        onClick={onNewThread}
        className="mb-4 flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-[9px] text-[13px] text-[var(--text-primary)] [border:0.5px_solid_var(--border-strong)] [transition:background_0.15s] hover:bg-[var(--bg-card)]"
      >
        <IconPlus size={14} />
        New thread
        <span className="ml-auto [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
          ⌘N
        </span>
      </button>

      {/* threads */}
      <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
        {groups.map((group) => (
          <div key={group.label} className="mb-1">
            <div className="px-1.5 pt-2 pb-1.5 [font-family:var(--font-mono)] text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
              {group.label}
            </div>
            {group.items.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectThread(t.id)}
                className={`mb-px w-full cursor-pointer truncate rounded-md px-2.5 py-[7px] text-left text-[13px] [transition:background_0.15s,color_0.15s] ${
                  view === "chat" && t.id === activeThreadId
                    ? "bg-[var(--bg-card)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
                }`}
              >
                {t.title}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* footer: agent + vault */}
      <div className="mt-auto flex items-center gap-2.5 px-1.5 pt-4 [border-top:0.5px_solid_var(--border)]">
        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[var(--bg-card)] [font-family:var(--font-mono)] text-[11px] text-[var(--text-primary)] [border:0.5px_solid_var(--border-strong)]">
          {shortenAddress(policy.owner, 2, 0).replace("…", "")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Dot color={revoked ? "var(--danger)" : "var(--success)"} pulse={!revoked} />
            <span className="[font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
              {revoked ? "agent revoked" : "agent live"}
            </span>
          </div>
          <div className="text-[13px] font-medium text-[var(--text-primary)]">
            {formatSol(policy.vaultBalance)} SOL
          </div>
        </div>
      </div>
    </aside>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] [transition:background_0.15s,color_0.15s] ${
        active
          ? "bg-[var(--bg-card)] text-[var(--text-primary)] [&_svg]:text-[var(--accent)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] [&_svg]:text-[var(--text-tertiary)]"
      }`}
    >
      <span className="[transition:color_0.15s]">{icon}</span>
      {label}
      {trailing && <span className="ml-auto flex items-center">{trailing}</span>}
    </button>
  );
}

type Group = { label: string; items: Thread[] };

function groupThreads(threads: Thread[]): Group[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const startOfYesterday = startOfToday - 86400;

  const today: Thread[] = [];
  const yesterday: Thread[] = [];
  const earlier: Thread[] = [];
  for (const t of threads) {
    if (t.updatedAt >= startOfToday) today.push(t);
    else if (t.updatedAt >= startOfYesterday) yesterday.push(t);
    else earlier.push(t);
  }

  return [
    { label: "Today", items: today },
    { label: "Yesterday", items: yesterday },
    { label: "Earlier", items: earlier },
  ].filter((g) => g.items.length > 0);
}
