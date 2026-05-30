"use client";

import {
  IconAlertTriangle,
  IconHistory,
  IconLogout,
  IconMessages,
  IconShieldLock,
  IconWallet,
} from "@tabler/icons-react";
import { useState } from "react";

import { ActivityLog } from "./ActivityLog";
import { AppSidebar } from "./AppSidebar";
import { useAuthSession } from "./AuthGate";
import { Conversation } from "./Conversation";
import { PolicyDashboard } from "./PolicyDashboard";
import {
  useConnectionState,
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
  const connection = useConnectionState();

  if (connection.phase === "loading") {
    return (
      <ApiStateScreen
        title="Connecting to Praxis API"
        message="Loading the live Aegis policy, activity log, and address book."
      />
    );
  }

  if (connection.phase === "error") {
    return (
      <ApiStateScreen
        error
        title="Praxis API is not ready"
        message={connection.message ?? "Check the backend environment and reload the app."}
      />
    );
  }

  return <ReadyAppShell />;
}

function ReadyAppShell() {
  const auth = useAuthSession();
  const provider = useProvider();
  const policy = usePolicy();
  const threads = useThreads();
  const activity = useActivity();
  const [view, setView] = useState<View>("chat");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const activeThreadId =
    threads.find((thread) => thread.id === selectedThreadId)?.id ??
    threads[0]?.id ??
    "t-welcome";

  const activeThread = useThread(activeThreadId);
  const revoked = policy.paused || policy.agentAuthority === SYSTEM_PROGRAM;
  const rejectedCount = activity.filter((a) => a.result === "rejected").length;

  const selectThread = (id: string) => {
    setSelectedThreadId(id);
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
            {auth && (
              <button
                type="button"
                onClick={() => void auth.signOut()}
                className="flex h-7 items-center gap-1.5 rounded-md bg-[var(--bg-card)] px-2 text-[12px] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)] [transition:color_0.15s,border-color_0.15s] hover:text-[var(--text-primary)] hover:[border-color:var(--border-strong)]"
                aria-label="Sign out"
                title="Sign out"
              >
                <IconWallet size={14} />
                <span className="max-[520px]:hidden">{shortAddress(auth.walletAddress)}</span>
                <IconLogout size={13} className="text-[var(--text-tertiary)]" />
              </button>
            )}
            <Pill>
              <Dot color={revoked ? "var(--danger)" : "var(--success)"} pulse={!revoked} />
              {revoked ? "Agent revoked" : "Agent live"}
            </Pill>
            <Pill className="max-[760px]:hidden">{formatSol(policy.vaultBalance)} SOL</Pill>
          </div>
        </header>

        {/* mobile surface switcher (sidebar is hidden on small screens) */}
        <div className="hidden gap-1 px-4 py-2 [border-bottom:0.5px_solid_var(--border)] max-[760px]:flex">
          <MobileTab label="Conversation" icon={<IconMessages size={15} />} active={view === "chat"} onClick={() => setView("chat")} />
          <MobileTab label="Policy" icon={<IconShieldLock size={15} />} active={view === "policy"} onClick={() => setView("policy")} />
          <MobileTab label="Activity" icon={<IconHistory size={15} />} active={view === "activity"} onClick={() => setView("activity")} />
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

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function ApiStateScreen({
  title,
  message,
  error = false,
}: {
  title: string;
  message: string;
  error?: boolean;
}) {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-[var(--bg)] px-6">
      <div className="max-w-[460px] rounded-xl bg-[var(--bg-card)] p-6 [border:0.5px_solid_var(--border-strong)]">
        <div className="mb-4 flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{
              background: error ? "rgba(199,91,91,0.14)" : "var(--accent-dim)",
              color: error ? "var(--danger)" : "var(--accent)",
            }}
          >
            {error ? (
              <IconAlertTriangle size={18} />
            ) : (
              <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
            )}
          </span>
          <h1 className="[font-family:var(--font-serif)] text-[24px] leading-none">
            {title}
          </h1>
        </div>
        <p className="text-[13.5px] leading-[1.6] text-[var(--text-secondary)]">
          {message}
        </p>
        {error && (
          <p className="mt-3 [font-family:var(--font-mono)] text-[11px] leading-[1.5] text-[var(--text-tertiary)]">
            API mode intentionally does not fall back to mock state. Check the live backend configuration and wallet session.
          </p>
        )}
      </div>
    </div>
  );
}

function MobileTab({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "page" : undefined}
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
