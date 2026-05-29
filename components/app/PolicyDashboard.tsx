"use client";

/**
 * The owner's view of the agent's envelope: live spend against the daily cap,
 * editable per-tx / daily limits, the session key + expiry, the allow-lists,
 * and the prominent Revoke kill switch. Everything reads/writes through the
 * provider — the same shapes a real Aegis client would.
 */

import type { AllowListKind, PolicyView } from "@praxis/shared";
import { remaining as calcRemaining } from "@praxis/shared";
import {
  IconCheck,
  IconKey,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconShieldX,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/praxis/Button";

import { RevokeDialog } from "./RevokeDialog";
import { useAddressBook, usePolicy, useProvider } from "./ProviderContext";
import { Card, Dot, Label } from "./ui";
import { formatSol, formatUnits, percentOf, shortenAddress, toBaseUnits } from "./lib/units";
import { useNow } from "./lib/useNow";
import { effectiveSpentToday } from "./mock/policy";
import { QUICK_MINTS, mintLabel, programLabel } from "./mock/labels";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export function PolicyDashboard() {
  const policy = usePolicy();
  const provider = useProvider();
  const [revokeOpen, setRevokeOpen] = useState(false);
  const now = useNow();
  const revoked = policy.paused || policy.agentAuthority === SYSTEM_PROGRAM;

  return (
    <div className="flex-1 overflow-y-auto px-8 py-7 max-[760px]:px-5">
      <div className="mx-auto max-w-[880px]">
        {/* header */}
        <div className="mb-7 flex items-start justify-between gap-4">
          <div>
            <h1 className="[font-family:var(--font-serif)] text-[34px] leading-none tracking-[-0.02em]">
              Policy envelope
            </h1>
            <p className="mt-2.5 text-[14px] text-[var(--text-secondary)]">
              What the agent may do — enforced on-chain by Aegis, not by a backend&rsquo;s good behavior.
            </p>
          </div>
          {revoked ? (
            <Button
              variant="primary"
              className="shrink-0"
              onClick={() => provider.rotateAgent()}
            >
              <IconRefresh size={15} />
              Re-enable agent
            </Button>
          ) : (
            <button
              type="button"
              onClick={() => setRevokeOpen(true)}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2.5 text-[14px] font-medium text-[var(--danger)] [transition:background_0.15s] hover:bg-[rgba(199,91,91,0.1)]"
              style={{ border: "0.5px solid rgba(199,91,91,0.4)" }}
            >
              <IconShieldX size={15} />
              Revoke agent
            </button>
          )}
        </div>

        {revoked && (
          <div
            className="mb-5 flex items-center gap-2.5 rounded-xl px-4 py-3 text-[13px] text-[var(--text-secondary)]"
            style={{ background: "rgba(199,91,91,0.10)", border: "0.5px solid rgba(199,91,91,0.3)" }}
          >
            <Dot color="var(--danger)" />
            Agent revoked — the session key is zeroed on-chain. Any agent action fails until you re-enable.
          </div>
        )}

        <SpendCard policy={policy} now={now} />

        <div className="mt-4 grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
          <CapsCard policy={policy} onSave={(patch) => provider.updatePolicy(patch)} />
          <SessionCard
            policy={policy}
            revoked={revoked}
            now={now}
            onRotate={() => provider.rotateAgent()}
            onUpdateExpiry={(expiryTs) => provider.updatePolicy({ expiryTs })}
          />
        </div>

        <Card className="mt-4 p-5">
          <Label className="mb-4">Allow-lists</Label>
          <div className="flex flex-col gap-5">
            <AllowList
              kind="programs"
              title="Programs"
              hint="Only these programs may be invoked"
              addresses={policy.allowedPrograms}
              labeler={programLabel}
            />
            <AllowList
              kind="mints"
              title="Verified mints"
              hint="The agent may only route into these mints"
              addresses={policy.allowedMints}
              labeler={mintLabel}
              quickAdd={QUICK_MINTS}
            />
            <AllowList
              kind="recipients"
              title="Recipients"
              hint="Empty means any recipient is allowed"
              addresses={policy.allowedRecipients}
              emptyMeansAny
            />
          </div>
        </Card>

        <VaultCard policy={policy} />
      </div>

      {revokeOpen && (
        <RevokeDialog onConfirm={() => provider.revokeAgent()} onClose={() => setRevokeOpen(false)} />
      )}
    </div>
  );
}

// --- live spend meter ---
function SpendCard({ policy, now }: { policy: PolicyView; now: number }) {
  const spent = effectiveSpentToday(policy, now);
  const remaining = calcRemaining(policy.dailyLimit, spent);
  const pct = percentOf(spent, policy.dailyLimit);

  return (
    <Card className="p-5">
      <div className="flex items-end justify-between">
        <div>
          <Label className="mb-2">Spent today</Label>
          <div className="[font-family:var(--font-serif)] text-[44px] leading-none tracking-[-0.02em]">
            {formatSol(spent)} <span className="text-[24px] text-[var(--text-tertiary)]">SOL</span>
          </div>
        </div>
        <div className="text-right">
          <div className="[font-family:var(--font-mono)] text-[12px] text-[var(--text-tertiary)]">
            {formatSol(remaining)} SOL left
          </div>
          <div className="[font-family:var(--font-mono)] text-[12px] text-[var(--text-tertiary)]">
            of {formatSol(policy.dailyLimit)} SOL daily cap
          </div>
        </div>
      </div>

      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
        <div
          className="h-full rounded-full [transition:width_0.5s_ease]"
          style={{
            width: `${pct}%`,
            background: pct >= 90 ? "var(--danger)" : pct >= 70 ? "var(--warning)" : "var(--accent)",
          }}
        />
      </div>
      <div className="mt-2 flex justify-between [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
        <span>resets on the rolling 24h window</span>
        <span>{pct.toFixed(0)}% used</span>
      </div>
    </Card>
  );
}

// --- caps ---
function CapsCard({
  policy,
  onSave,
}: {
  policy: PolicyView;
  onSave: (patch: { maxPerTx?: bigint; dailyLimit?: bigint }) => void;
}) {
  return (
    <Card className="p-5">
      <Label className="mb-4">Caps</Label>
      <div className="flex flex-col gap-4">
        <CapRow
          label="Per transaction"
          value={policy.maxPerTx}
          onSave={(v) => onSave({ maxPerTx: v })}
        />
        <div className="h-px bg-[var(--border)]" />
        <CapRow
          label="Daily limit"
          value={policy.dailyLimit}
          onSave={(v) => onSave({ dailyLimit: v })}
        />
      </div>
    </Card>
  );
}

function CapRow({
  label,
  value,
  onSave,
}: {
  label: string;
  value: bigint;
  onSave: (v: bigint) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);

  const begin = () => {
    setDraft(formatUnits(value, 9, { maxFrac: 9 }));
    setError(false);
    setEditing(true);
  };

  const commit = () => {
    try {
      onSave(toBaseUnits(draft, 9));
      setEditing(false);
    } catch {
      setError(true);
    }
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-[var(--text-secondary)]">{label}</span>
      {editing ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-24 rounded-md bg-[var(--bg)] px-2 py-1 text-right [font-family:var(--font-mono)] text-[13px] text-[var(--text-primary)] outline-none"
            style={{
              border: `0.5px solid ${error ? "var(--danger)" : "var(--border-strong)"}`,
            }}
          />
          <span className="[font-family:var(--font-mono)] text-[12px] text-[var(--text-tertiary)]">
            SOL
          </span>
          <button
            type="button"
            onClick={commit}
            aria-label="Save"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--success)] hover:bg-[var(--bg-elevated)]"
          >
            <IconCheck size={14} />
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            aria-label="Cancel"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)]"
          >
            <IconX size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={begin}
          className="group flex items-center gap-2 [font-family:var(--font-mono)] text-[15px] text-[var(--text-primary)]"
        >
          {formatSol(value)} SOL
          <IconPencil
            size={13}
            className="text-[var(--text-quaternary)] [transition:color_0.15s] group-hover:text-[var(--accent)]"
          />
        </button>
      )}
    </div>
  );
}

// --- session key ---
function SessionCard({
  policy,
  revoked,
  now,
  onRotate,
  onUpdateExpiry,
}: {
  policy: PolicyView;
  revoked: boolean;
  now: number;
  onRotate: () => void;
  onUpdateExpiry: (expiryTs: number) => void;
}) {
  const extendSevenDays = () => onUpdateExpiry(now + 7 * 86400);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <Label>Session key</Label>
        <button
          type="button"
          onClick={onRotate}
          className="inline-flex items-center gap-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)] [transition:color_0.15s] hover:text-[var(--text-primary)]"
        >
          <IconRefresh size={12} />
          rotate
        </button>
      </div>

      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)]">
          <IconKey size={15} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Dot color={revoked ? "var(--danger)" : "var(--success)"} pulse={!revoked} />
            <span className="text-[13px] font-medium">{revoked ? "Revoked" : "Live"}</span>
          </div>
          <div className="truncate [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
            {revoked ? "key zeroed on-chain" : shortenAddress(policy.agentAuthority, 6, 6)}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-[13px]">
        <span className="text-[var(--text-secondary)]">Expires</span>
        <div className="flex items-center gap-2">
          <span className="[font-family:var(--font-mono)] text-[var(--text-primary)]">
            {formatExpiry(policy.expiryTs, now)}
          </span>
          <button
            type="button"
            onClick={extendSevenDays}
            className="rounded-md px-2 py-1 [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)]"
          >
            extend 7d
          </button>
        </div>
      </div>
    </Card>
  );
}

// --- vault ---
function VaultCard({ policy }: { policy: PolicyView }) {
  return (
    <Card className="mt-4 flex items-center justify-between p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)]">
          <IconWallet size={17} />
        </span>
        <div>
          <Label>Agent vault</Label>
          <div className="mt-1 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
            {shortenAddress(policy.address, 6, 6)} · owner {shortenAddress(policy.owner)}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="[font-family:var(--font-serif)] text-[26px] leading-none tracking-[-0.02em]">
          {formatSol(policy.vaultBalance)}{" "}
          <span className="text-[15px] text-[var(--text-tertiary)]">SOL</span>
        </div>
        <div className="mt-1 [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
          owner withdraw is unconstrained
        </div>
      </div>
    </Card>
  );
}

// --- allow-list editor ---
function AllowList({
  kind,
  title,
  hint,
  addresses,
  labeler,
  quickAdd,
  emptyMeansAny,
}: {
  kind: AllowListKind;
  title: string;
  hint: string;
  addresses: string[];
  labeler?: (a: string) => string | null;
  quickAdd?: { label: string; address: string }[];
  emptyMeansAny?: boolean;
}) {
  const provider = useProvider();
  const book = useAddressBook();
  const [draft, setDraft] = useState("");

  const recipientName = (a: string) =>
    book.find((e) => e.address === a)?.name ?? null;

  const nameFor = (a: string) =>
    labeler?.(a) ?? (kind === "recipients" ? recipientName(a) : null);

  const recipientQuickAdd =
    kind === "recipients"
      ? book
          .filter((e) => !addresses.includes(e.address))
          .map((e) => ({ label: e.name, address: e.address }))
      : quickAdd?.filter((q) => !addresses.includes(q.address)) ?? [];

  const add = (address: string) => {
    if (!address.trim()) return;
    void provider.addToAllowList(kind, address.trim());
    setDraft("");
  };

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-[var(--text-primary)]">{title}</span>
        <span className="[font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
          {hint}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {addresses.length === 0 && emptyMeansAny && (
          <span className="rounded-full bg-[var(--bg-elevated)] px-3 py-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)]">
            Any recipient · no restriction
          </span>
        )}

        {addresses.map((a) => {
          const name = nameFor(a);
          return (
            <span
              key={a}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--bg-elevated)] py-1.5 pr-1.5 pl-3 text-[12px] [border:0.5px_solid_var(--border)]"
            >
              <span className="text-[var(--text-primary)]">{name ?? shortenAddress(a)}</span>
              {name && (
                <span className="[font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
                  {shortenAddress(a)}
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove ${name ?? a}`}
                onClick={() => provider.removeFromAllowList(kind, a)}
                className="flex h-4 w-4 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-card)] hover:text-[var(--danger)]"
              >
                <IconX size={11} />
              </button>
            </span>
          );
        })}
      </div>

      {/* quick-add + paste */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {recipientQuickAdd.map((q) => (
          <button
            key={q.address}
            type="button"
            onClick={() => add(q.address)}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)] [border:0.5px_dashed_var(--border-strong)] [transition:color_0.15s] hover:text-[var(--accent)]"
          >
            <IconPlus size={11} />
            {q.label}
          </button>
        ))}
        <div className="flex items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add(draft);
            }}
            placeholder="paste address…"
            className="w-[150px] rounded-md bg-[var(--bg)] px-2.5 py-1 [font-family:var(--font-mono)] text-[11px] text-[var(--text-primary)] outline-none [border:0.5px_solid_var(--border)] placeholder:text-[var(--text-quaternary)] focus:[border-color:var(--border-bright)]"
          />
          {draft.trim() && (
            <button
              type="button"
              onClick={() => add(draft)}
              aria-label="Add address"
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--accent)] hover:bg-[var(--bg-elevated)]"
            >
              <IconPlus size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatExpiry(expiryTs: number, now: number): string {
  const secs = expiryTs - now;
  if (secs <= 0) return "expired";
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  if (days >= 1) return `in ${days}d ${hours}h`;
  const mins = Math.floor((secs % 3600) / 60);
  return `in ${hours}h ${mins}m`;
}
