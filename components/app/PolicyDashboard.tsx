"use client";

/**
 * The owner's view of the agent's envelope: live spend against the daily cap,
 * editable per-tx / daily limits, the session key + expiry, the allow-lists,
 * and the prominent Revoke kill switch. Everything reads/writes through the
 * provider — the same shapes a real Aegis client would.
 */

import type { AllowListKind, PolicyView, TokenEnvelopeConfig } from "@praxis/shared";
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
import { effectiveSpentToday, effectiveTokenSpentToday } from "./lib/policyMath";
import {
  QUICK_MINTS,
  TOKEN_ENVELOPE_MINTS,
  mintDecimals,
  mintLabel,
  programLabel,
} from "./lib/tokenCatalog";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export function PolicyDashboard() {
  const policy = usePolicy();
  const provider = useProvider();
  const addressBook = useAddressBook();
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  const revoked = policy.paused || policy.agentAuthority === SYSTEM_PROGRAM;
  const runMutation = (action: () => Promise<void>, fallback: string) => {
    setError(null);
    void action().catch((err) => {
      setError(messageFromError(err, fallback));
    });
  };
  const addToAllowList = (kind: AllowListKind, address: string) => {
    runMutation(() => provider.addToAllowList(kind, address), "Allow-list update failed.");
  };
  const removeFromAllowList = (kind: AllowListKind, address: string) => {
    runMutation(() => provider.removeFromAllowList(kind, address), "Allow-list update failed.");
  };

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
              onClick={() => {
                runMutation(() => provider.rotateAgent(), "Re-enable failed.");
              }}
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
            Agent revoked — the session key is zeroed on-chain. Rotate in a fresh key before re-enabling.
          </div>
        )}

        {error && (
          <div className="mb-5 rounded-xl bg-[rgba(199,91,91,0.10)] px-4 py-3 text-[13px] leading-[1.45] text-[var(--danger)] [border:0.5px_solid_rgba(199,91,91,0.28)]">
            {error}
          </div>
        )}

        <SpendCard policy={policy} now={now} />

        <div className="mt-4 grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
          <CapsCard
            policy={policy}
            onSave={(patch) => {
              runMutation(() => provider.updatePolicy(patch), "Policy update failed.");
            }}
          />
          <SessionCard
            policy={policy}
            revoked={revoked}
            now={now}
            onRotate={() => {
              runMutation(() => provider.rotateAgent(), "Rotate failed.");
            }}
            onUpdateExpiry={(expiryTs) => {
              runMutation(() => provider.updatePolicy({ expiryTs }), "Expiry update failed.");
            }}
          />
        </div>

        <TokenEnvelopeCard
          policy={policy}
          now={now}
          onConfigure={(config) => {
            runMutation(() => provider.configureToken(config), "Token configuration failed.");
          }}
          onPrepareAccounts={() => {
            runMutation(
              () => provider.prepareTokenAccounts(addressBook.map((entry) => entry.address)),
              "Token account setup failed.",
            );
          }}
        />

        <Card className="mt-4 p-5">
          <Label className="mb-4">Allow-lists</Label>
          <div className="flex flex-col gap-5">
            <AllowList
              kind="programs"
              title="Programs"
              hint="Only these programs may be invoked"
              addresses={policy.allowedPrograms}
              labeler={programLabel}
              onAdd={addToAllowList}
              onRemove={removeFromAllowList}
            />
            <AllowList
              kind="mints"
              title="Verified mints"
              hint="The agent may only route into these mints"
              addresses={policy.allowedMints}
              labeler={mintLabel}
              quickAdd={QUICK_MINTS}
              onAdd={addToAllowList}
              onRemove={removeFromAllowList}
            />
            <AllowList
              kind="recipients"
              title="Recipients"
              hint="Empty means any recipient is allowed"
              addresses={policy.allowedRecipients}
              emptyMeansAny
              onAdd={addToAllowList}
              onRemove={removeFromAllowList}
            />
          </div>
        </Card>

        <VaultCard
          policy={policy}
          onFund={(amount) => runMutation(() => provider.fundVault(amount), "Could not add funds to the vault.")}
        />
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

// --- SPL token envelope (separate asset, its own caps) ---
function TokenEnvelopeCard({
  policy,
  now,
  onConfigure,
  onPrepareAccounts,
}: {
  policy: PolicyView;
  now: number;
  onConfigure: (config: TokenEnvelopeConfig) => void;
  onPrepareAccounts: () => void;
}) {
  const configured = policy.tokenMint !== SYSTEM_PROGRAM;
  const decimals = mintDecimals(policy.tokenMint);
  const symbol = mintLabel(policy.tokenMint) ?? "TOKEN";

  // Default caps when (re)selecting a token: 200 per-tx / 500 daily, in its units.
  const defaultsFor = (mint: string): TokenEnvelopeConfig => ({
    tokenMint: mint,
    tokenMaxPerTx: toBaseUnits("200", mintDecimals(mint)),
    tokenDailyLimit: toBaseUnits("500", mintDecimals(mint)),
  });

  const pick = (mint: string) => onConfigure(defaultsFor(mint));

  return (
    <Card className="mt-4 p-5">
      <div className="mb-4 flex items-center justify-between">
        <Label>Token transfers (SPL)</Label>
        {configured && (
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--bg-elevated)] px-3 py-1 text-[11px] [border:0.5px_solid_var(--border)]">
            <span className="text-[var(--text-primary)]">{symbol}</span>
            <span className="[font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
              {shortenAddress(policy.tokenMint)}
            </span>
          </span>
        )}
      </div>

      {!configured ? (
        <div>
          <p className="mb-3 text-[13px] text-[var(--text-secondary)]">
            No SPL token configured. Pick one to let the agent move it within its own
            on-chain caps (separate from the SOL envelope).
          </p>
          <div className="flex flex-wrap gap-2">
            {TOKEN_ENVELOPE_MINTS.map((m) => (
              <button
                key={m.address}
                type="button"
                onClick={() => pick(m.address)}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)] [border:0.5px_dashed_var(--border-strong)] [transition:color_0.15s] hover:text-[var(--accent)]"
              >
                <IconPlus size={11} />
                {m.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <TokenSpend policy={policy} now={now} decimals={decimals} symbol={symbol} />
          <div className="h-px bg-[var(--border)]" />
          <CapRow
            label="Per transaction"
            value={policy.tokenMaxPerTx}
            decimals={decimals}
            unit={symbol}
            onSave={(v) =>
              onConfigure({
                tokenMint: policy.tokenMint,
                tokenMaxPerTx: v,
                tokenDailyLimit: policy.tokenDailyLimit,
              })
            }
          />
          <CapRow
            label="Daily limit"
            value={policy.tokenDailyLimit}
            decimals={decimals}
            unit={symbol}
            onSave={(v) =>
              onConfigure({
                tokenMint: policy.tokenMint,
                tokenMaxPerTx: policy.tokenMaxPerTx,
                tokenDailyLimit: v,
              })
            }
          />
          <div className="flex items-center gap-2">
            <span className="[font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
              switch token:
            </span>
            {TOKEN_ENVELOPE_MINTS.filter((m) => m.address !== policy.tokenMint).map((m) => (
              <button
                key={m.address}
                type="button"
                onClick={() => pick(m.address)}
                className="rounded-full px-2.5 py-1 [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)] [border:0.5px_dashed_var(--border-strong)] hover:text-[var(--accent)]"
              >
                {m.label}
              </button>
            ))}
            <button
              type="button"
              onClick={onPrepareAccounts}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)]"
            >
              <IconWallet size={11} />
              prepare accounts
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function TokenSpend({
  policy,
  now,
  decimals,
  symbol,
}: {
  policy: PolicyView;
  now: number;
  decimals: number;
  symbol: string;
}) {
  const spent = effectiveTokenSpentToday(policy, now);
  const left = calcRemaining(policy.tokenDailyLimit, spent);
  const pct = percentOf(spent, policy.tokenDailyLimit);
  const fmt = (v: bigint) => formatUnits(v, decimals, { maxFrac: 4 });

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="[font-family:var(--font-mono)] text-[13px] text-[var(--text-primary)]">
          {fmt(spent)} {symbol} <span className="text-[var(--text-tertiary)]">spent today</span>
        </span>
        <span className="[font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
          {fmt(left)} of {fmt(policy.tokenDailyLimit)} {symbol} left
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
        <div
          className="h-full rounded-full [transition:width_0.5s_ease]"
          style={{
            width: `${pct}%`,
            background: pct >= 90 ? "var(--danger)" : pct >= 70 ? "var(--warning)" : "var(--accent)",
          }}
        />
      </div>
    </div>
  );
}

function CapRow({
  label,
  value,
  onSave,
  decimals = 9,
  unit = "SOL",
}: {
  label: string;
  value: bigint;
  onSave: (v: bigint) => void;
  decimals?: number;
  unit?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);

  const begin = () => {
    setDraft(formatUnits(value, decimals, { maxFrac: decimals }));
    setError(false);
    setEditing(true);
  };

  const commit = () => {
    try {
      onSave(toBaseUnits(draft, decimals));
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
            {unit}
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
          {formatUnits(value, decimals, { maxFrac: 4 })} {unit}
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
function VaultCard({
  policy,
  onFund,
}: {
  policy: PolicyView;
  onFund: (amount: bigint) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const parsed = parseFundAmount(draft);

  const submit = () => {
    if (parsed === null) return;
    onFund(parsed);
    setDraft("");
    setAdding(false);
  };

  return (
    <Card className="mt-4 p-5">
      <div className="flex items-center justify-between">
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
          <button
            type="button"
            onClick={() => setAdding((value) => !value)}
            className="mt-1.5 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)]"
          >
            <IconPlus size={12} /> Add funds
          </button>
        </div>
      </div>

      {adding && (
        <div className="mt-4 flex items-center gap-2 [border-top:0.5px_solid_var(--border)] pt-4">
          <div className="relative flex-1">
            <input
              autoFocus
              inputMode="decimal"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && submit()}
              placeholder="0.5"
              className="h-9 w-full rounded-md bg-[var(--bg)] pl-3 pr-12 text-[13px] text-[var(--text-primary)] [border:0.5px_solid_var(--border)] outline-none focus:[border-color:var(--accent)]"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-tertiary)]">
              SOL
            </span>
          </div>
          <Button onClick={submit} disabled={parsed === null}>
            Deposit
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Parse a human SOL amount into lamports; null if blank/invalid/non-positive. */
function parseFundAmount(value: string): bigint | null {
  if (!value.trim()) return null;
  try {
    const lamports = toBaseUnits(value.trim(), 9);
    return lamports > 0n ? lamports : null;
  } catch {
    return null;
  }
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
  onAdd,
  onRemove,
}: {
  kind: AllowListKind;
  title: string;
  hint: string;
  addresses: string[];
  labeler?: (a: string) => string | null;
  quickAdd?: { label: string; address: string }[];
  emptyMeansAny?: boolean;
  onAdd: (kind: AllowListKind, address: string) => void;
  onRemove: (kind: AllowListKind, address: string) => void;
}) {
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
    onAdd(kind, address.trim());
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
                onClick={() => {
                  onRemove(kind, a);
                }}
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

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
