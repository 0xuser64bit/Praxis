"use client";

import {
  IconHistory,
  IconMessages,
  IconShieldLock,
} from "@tabler/icons-react";
import { useState } from "react";

import { ActivityLog } from "./ActivityLog";
import { AppSidebar } from "./AppSidebar";
import { Conversation } from "./Conversation";
import { PolicyDashboard } from "./PolicyDashboard";
import {
  useActivity,
  usePolicy,
  useProvider,
  useThread,
  useThreads,
} from "./ProviderContext";
import { Dot, Pill } from "./ui";
import { formatSol } from "./lib/units";

export type View = "chat" | "policy" | "activity";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export function AppShell() {
  const provider = useProvider();
  const policy = usePolicy();
  const threads = useThreads();
  const activity = useActivity();
  const [view, setView] = useState<View>("chat");
  const [activeThreadId, setActiveThreadId] = useState("t-welcome");

  const activeThread = useThread(activeThreadId);
  const revoked = policy.paused || policy.agentAuthority === SYSTEM_PROGRAM;
  const rejectedCount = activity.filter((a) => a.result === "rejected").length;

  const selectThread = (id: string) => {
    setActiveThreadId(id);
    setView("chat");
  };
  const newThread = () => {
    const id = provider.newThread();
    selectThread(id);
  };

  const breadcrumb =
    view === "chat"
      ? activeThread?.title ?? "Conversation"
      : view === "policy"
        ? "Policy envelope"
        : "Activity log";

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <AppSidebar
        view={view}
        onView={setView}
        threads={threads}
        activeThreadId={activeThreadId}
        onSelectThread={selectThread}
        onNewThread={newThread}
        policy={policy}
        rejectedCount={rejectedCount}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <header className="flex h-[56px] shrink-0 items-center justify-between gap-3 px-6 [border-bottom:0.5px_solid_var(--border)] max-[760px]:px-4">
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="text-[var(--text-tertiary)] capitalize max-[760px]:hidden">
              {view === "chat" ? "Conversation" : view}
            </span>
            <span className="text-[var(--text-tertiary)] max-[760px]:hidden">›</span>
            <span className="truncate font-medium text-[var(--text-primary)]">{breadcrumb}</span>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <Pill>
              <Dot color={revoked ? "var(--danger)" : "var(--success)"} pulse={!revoked} />
              {revoked ? "Agent revoked" : "Agent live"}
            </Pill>
            <Pill className="max-[760px]:hidden">{formatSol(policy.vaultBalance)} SOL</Pill>
          </div>
        </header>

        {/* mobile surface switcher (sidebar is hidden on small screens) */}
        <div className="hidden gap-1 px-4 py-2 [border-bottom:0.5px_solid_var(--border)] max-[760px]:flex">
          <MobileTab icon={<IconMessages size={15} />} active={view === "chat"} onClick={() => setView("chat")} />
          <MobileTab icon={<IconShieldLock size={15} />} active={view === "policy"} onClick={() => setView("policy")} />
          <MobileTab icon={<IconHistory size={15} />} active={view === "activity"} onClick={() => setView("activity")} />
        </div>

        {view === "chat" && (
          <Conversation threadId={activeThreadId} onOpenPolicy={() => setView("policy")} />
        )}
        {view === "policy" && <PolicyDashboard />}
        {view === "activity" && <ActivityLog />}
      </main>
    </div>
  );
}

function MobileTab({
  icon,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center rounded-md py-2 [transition:background_0.15s,color_0.15s] ${
        active
          ? "bg-[var(--bg-card)] text-[var(--accent)]"
          : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {icon}
    </button>
  );
}
