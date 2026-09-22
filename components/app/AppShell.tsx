"use client";

import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
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
import { MobileThreadBar } from "./MobileThreadBar";
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
import { messageFromError } from "./lib/useAsyncAction";
import { formatSol, shortenAddress } from "./lib/units";
import { KNOWN_PROGRAMS } from "./lib/tokenCatalog";

export type View = "chat" | "policy" | "activity";

const SYSTEM_PROGRAM = KNOWN_PROGRAMS.system;

export function AppShell() {
  const provider = useProvider();
  const connection = useConnectionState();
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  // Structural, not textual: the backend tags a first-run wallet with the
  // `policy_not_found` code and hands back the PDA in `details`. Matching on
  // the message text (as this did) broke the moment the copy changed.
  const needsOnboarding = connection.phase === "error" && connection.code === "policy_not_found";

  const createVault = async (fundLamports: bigint) => {
    setBootstrapping(true);
    setBootstrapError(null);
    try {
      await provider.bootstrapPolicy(fundLamports);
    } catch (error) {
      setBootstrapError(messageFromError(error, "Could not set up your vault."));
    } finally {
      setBootstrapping(false);
    }
  };

  if (connection.phase === "loading") {
    return (
      <ApiStateScreen
        title="Connecting to Praxis"
        message="Loading your policy, activity log, and address book."
      />
    );
  }

  if (needsOnboarding) {
    return (
      <PolicyOnboarding
        policyAddress={connection.phase === "error" ? connection.policyAddress : undefined}
        busy={bootstrapping}
        error={bootstrapError}
        onCreate={createVault}
      />
    );
  }

  if (connection.phase === "error") {
    return (
      <ApiStateScreen
        error
        title="Praxis is having trouble"
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
  const agentDead = policy.agentAuthority === SYSTEM_PROGRAM;
  const agentInactive = agentDead || policy.paused;
  const agentPill = agentDead ? "Agent revoked" : policy.paused ? "Agent paused" : "Agent live";
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
                <span className="max-[520px]:hidden">{shortenAddress(auth.walletAddress)}</span>
                <IconLogout size={13} className="text-[var(--text-tertiary)]" />
              </button>
            )}
            <Pill>
              <Dot color={agentInactive ? "var(--danger)" : "var(--success)"} pulse={!agentInactive} />
              {agentPill}
            </Pill>
            <Pill className="max-[760px]:hidden">{formatSol(policy.vaultBalance)} SOL</Pill>
          </div>
        </header>

        {/* Mobile surfaces. The sidebar owns view switching AND the thread
            list on desktop, and is hidden below 760px, so both live here. */}
        <div className="hidden shrink-0 [border-bottom:0.5px_solid_var(--border)] max-[760px]:block">
          <div className="flex gap-1 px-4 py-2">
            <MobileTab label="Conversation" icon={<IconMessages size={15} />} active={view === "chat"} onClick={() => setView("chat")} />
            <MobileTab label="Policy" icon={<IconShieldLock size={15} />} active={view === "policy"} onClick={() => setView("policy")} />
            <MobileTab label="Activity" icon={<IconHistory size={15} />} active={view === "activity"} onClick={() => setView("activity")} />
          </div>
          {view === "chat" && (
            <MobileThreadBar
              threads={threads}
              activeThreadId={activeThreadId}
              onSelectThread={selectThread}
              onNewThread={newThread}
            />
          )}
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

const FUNDING_PRESETS: { label: string; lamports: bigint }[] = [
  { label: "Fund later", lamports: 0n },
  { label: "0.5 SOL", lamports: 500_000_000n },
  { label: "1 SOL", lamports: 1_000_000_000n },
  { label: "2 SOL", lamports: 2_000_000_000n },
];

const ONBOARDING_POINTS = [
  "You set the limits — per-transaction and daily caps you can change anytime.",
  "Funds stay in your vault. Only you can withdraw, and you can revoke the agent instantly.",
  "This is devnet: the SOL is free test currency, not real money.",
];

/**
 * First-run onboarding shown when the signed-in wallet has no Aegis policy yet.
 * Framed as setup (not an error): explains the vault, lets the owner choose an
 * optional initial funding amount, and tucks the raw PDA behind a disclosure.
 */
function PolicyOnboarding({
  policyAddress,
  busy,
  error,
  onCreate,
}: {
  policyAddress?: string;
  busy: boolean;
  error?: string | null;
  onCreate: (fundLamports: bigint) => void;
}) {
  const [selected, setSelected] = useState(2); // default: 1 SOL
  const [showDetails, setShowDetails] = useState(false);
  const auth = useAuthSession();
  const preset = FUNDING_PRESETS[selected];
  const buttonLabel = busy
    ? "Confirm in your wallet"
    : preset.lamports === 0n
      ? "Create my vault"
      : `Create vault + fund ${preset.label}`;

  return (
    <div className="flex h-[100dvh] items-center justify-center bg-[var(--bg)] px-6">
      <div className="w-full max-w-[480px] rounded-lg bg-[var(--bg-card)] p-6 [border:0.5px_solid_var(--border-strong)]">
        <div className="mb-4 flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: "var(--accent-dim)", color: "var(--accent)" }}
          >
            <IconShieldLock size={18} />
          </span>
          <h1 className="[font-family:var(--font-serif)] text-[24px] leading-none">
            Set up your Praxis vault
          </h1>
        </div>

        <p className="text-[13.5px] leading-[1.6] text-[var(--text-secondary)]">
          Praxis moves funds for you through an on-chain spending policy that you
          own and control. Create your vault to get started — fund it now or later.
        </p>

        <ul className="mt-4 flex flex-col gap-2.5">
          {ONBOARDING_POINTS.map((point) => (
            <li key={point} className="flex items-start gap-2.5 text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
              <IconCheck size={15} className="mt-[2px] shrink-0 text-[var(--accent)]" />
              <span>{point}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5">
          <p className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
            Fund now (optional)
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {FUNDING_PRESETS.map((option, index) => (
              <button
                key={option.label}
                type="button"
                disabled={busy}
                onClick={() => setSelected(index)}
                // Border on both states, colour-only change: a selected chip
                // that drops its border also drops 1px of box and nudges its
                // own label.
                className={`h-9 rounded-md px-2 text-[12px] font-medium [border:0.5px_solid] [transition:background_0.15s,color_0.15s,border-color_0.15s] disabled:cursor-not-allowed ${
                  index === selected
                    ? "bg-[var(--accent)] text-[var(--bg)] [border-color:var(--accent)]"
                    : "bg-[var(--bg)] text-[var(--text-secondary)] [border-color:var(--border)] hover:[border-color:var(--border-strong)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => onCreate(preset.lamports)}
          className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--bg)] [transition:opacity_0.15s] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? (
            <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          ) : (
            <IconShieldLock size={16} />
          )}
          {buttonLabel}
        </button>

        {error && (
          <div className="mt-4 rounded-md bg-[rgba(199,91,91,0.12)] p-3 text-[12.5px] leading-[1.5] text-[var(--danger)]">
            {error}
          </div>
        )}

        {policyAddress && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowDetails((value) => !value)}
              className="flex items-center gap-1 text-[11.5px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            >
              <IconChevronDown
                size={13}
                className={`[transition:transform_0.15s] ${showDetails ? "" : "-rotate-90"}`}
              />
              Advanced details
            </button>
            {showDetails && (
              <div className="mt-2 rounded-md bg-[var(--bg)] p-3 [border:0.5px_solid_var(--border)]">
                <p className="text-[11px] leading-[1.5] text-[var(--text-tertiary)]">
                  Your Aegis policy account (a program address derived from your wallet):
                </p>
                <p className="mt-1 break-all [font-family:var(--font-mono)] text-[11px] text-[var(--text-secondary)]">
                  {policyAddress}
                </p>
              </div>
            )}
          </div>
        )}

        {auth && (
          <div className="mt-5 flex items-center justify-between [border-top:0.5px_solid_var(--border)] pt-4 text-[12px] text-[var(--text-tertiary)]">
            <span>
              Signed in as{" "}
              <span className="[font-family:var(--font-mono)]">
                {shortenAddress(auth.walletAddress)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void auth.signOut()}
              aria-label="Sign out"
              className="flex items-center gap-1 hover:text-[var(--text-primary)]"
            >
              <IconLogout size={13} />
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ApiStateScreen({
  title,
  message,
  detail,
  action,
  error = false,
}: {
  title: string;
  message: string;
  detail?: string | null;
  action?: { label: string; busy?: boolean; onClick: () => void };
  error?: boolean;
}) {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-[var(--bg)] px-6">
      <div className="w-full max-w-[460px] rounded-lg bg-[var(--bg-card)] p-6 [border:0.5px_solid_var(--border-strong)]">
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
        {detail && (
          <div className="mt-4 rounded-md bg-[rgba(199,91,91,0.12)] p-3 text-[12.5px] leading-[1.5] text-[var(--danger)]">
            {detail}
          </div>
        )}
        {action && (
          <button
            type="button"
            disabled={action.busy}
            onClick={action.onClick}
            className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--bg)] [transition:opacity_0.15s] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {action.busy ? (
              <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
            ) : (
              <IconShieldLock size={16} />
            )}
            {action.label}
          </button>
        )}
        {error && (
          <p className="mt-3 text-[11.5px] leading-[1.5] text-[var(--text-tertiary)]">
            This usually clears on reload. If it persists, the live backend or your
            wallet session may need attention.
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
