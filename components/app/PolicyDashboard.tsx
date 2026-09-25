"use client";

/**
 * The owner's view of the agent's envelope: live spend against the daily cap,
 * editable per-tx / daily limits, the session key + expiry, the allow-lists,
 * and the prominent Revoke kill switch. Everything reads/writes through the
 * provider — the same shapes a real Aegis client would.
 */

import type { AllowListKind, PolicyView, TokenEnvelopeConfig } from "@praxis/shared";
import { remaining as calcRemaining, VAULT_RENT_RESERVE_LAMPORTS } from "@praxis/shared";
import {
  IconAlertTriangle,
  IconArrowUp,
  IconCheck,
  IconKey,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconShieldX,
  IconTrash,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/praxis/Button";

import { StockSwitcher, useActiveStock } from "./ActiveStock";
import { ConfirmDialog } from "./ConfirmDialog";
import { RevokeDialog } from "./RevokeDialog";
import {
  actionKeys,
  AsyncActionProvider,
  useActionCompletion,
  useActionState,
  useAsyncActions,
} from "./lib/useAsyncAction";
import { useToast } from "./Toast";
import { useAddressBook, usePolicy, useProvider } from "./ProviderContext";
import { Card, Dot, Label, Surface } from "./ui";
import {
  formatEditableUnits,
  formatSol,
  formatUnits,
  formatUsdAmount,
  percentOf,
  shortenAddress,
  toBaseUnits,
} from "./lib/units";
import { useNow } from "./lib/useNow";
import {
  effectiveSpentToday,
  effectiveTokenSpentToday,
  expiryAfterSevenDays,
  getAgentState,
  type AgentState,
} from "./lib/policyMath";
import { KNOWN_PROGRAMS, mintLabel, programLabel } from "./lib/tokenCatalog";
import { useTokenCatalog } from "./TokenCatalog";
import { useTokenMeta, VaultTokenBalance } from "./VaultToken";

const SYSTEM_PROGRAM = KNOWN_PROGRAMS.system;

export function PolicyDashboard() {
  const policy = usePolicy();
  const provider = useProvider();
  const addressBook = useAddressBook();
  const { allowListCandidates } = useTokenCatalog();
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [tab, setTab] = useState<"overview" | "advanced">("overview");
  const now = useNow();
  const { toast } = useToast();
  const agentState = getAgentState(policy, now);
  const inactive = agentState !== "live";
  const actions = useAsyncActions(toast);
  const { run, busy } = actions;
  const addToAllowList = (kind: AllowListKind, address: string) => {
    run(
      actionKeys.allowList(kind, address, "add"),
      () => provider.addToAllowList(kind, address),
      { label: "Updating allow-list", fallback: "Allow-list update failed.", success: "Allow-list updated." },
    );
  };
  const removeFromAllowList = (kind: AllowListKind, address: string) => {
    run(
      actionKeys.allowList(kind, address, "remove"),
      () => provider.removeFromAllowList(kind, address),
      { label: "Updating allow-list", fallback: "Allow-list update failed.", success: "Allow-list updated." },
    );
  };
  // Quick-adds come from the cluster-verified catalog rather than a static
  // mainnet list: an allow-list entry for a mint that does not exist here is
  // a policy write that can never match anything.
  const mintQuickAdd = allowListCandidates.map((entry) => ({
    label: entry.symbol,
    address: entry.mint,
  }));

  return (
    <AsyncActionProvider value={actions}>
      <Surface>
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
          {inactive ? (
            <Button
              variant="primary"
              className="shrink-0"
              disabled={busy}
              onClick={() => {
                if (agentState === "paused") {
                  run(actionKeys.pause, () => provider.updatePolicy({ paused: false }), {
                    label: "Unpausing the agent",
                    fallback: "Could not unpause the agent.",
                    success: "Agent unpaused.",
                  });
                } else if (agentState === "expired") {
                  run(
                    actionKeys.expiry,
                    () =>
                      provider.updatePolicy({
                        expiryTs: expiryAfterSevenDays(policy.expiryTs, now),
                        paused: false,
                      }),
                    {
                      label: "Restoring the agent session",
                      fallback: "Could not restore the agent session.",
                      success: "Agent session restored for seven more days.",
                    },
                  );
                } else {
                  run(actionKeys.rotate, () => provider.rotateAgent(), {
                    label: "Rotating the session key",
                    fallback: "Re-enable failed.",
                    success: "Agent re-enabled with a fresh session key.",
                  });
                }
              }}
            >
              {actions.pendingKey === actionKeys.pause ||
              actions.pendingKey === actionKeys.expiry ||
              actions.pendingKey === actionKeys.rotate ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              ) : (
                <IconRefresh size={15} />
              )}
              {agentState === "paused"
                ? "Unpause agent"
                : agentState === "expired"
                  ? "Restore session"
                  : "Re-enable agent"}
            </Button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setRevokeOpen(true)}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2.5 text-[14px] font-medium text-[var(--danger)] [transition:background_0.15s] hover:bg-[rgba(199,91,91,0.1)] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ border: "0.5px solid rgba(199,91,91,0.4)" }}
            >
              <IconShieldX size={15} />
              Revoke agent
            </button>
          )}
        </div>

        {agentState === "revoked" && (
          <div
            className="mb-5 flex items-center gap-2.5 rounded-xl px-4 py-3 text-[13px] text-[var(--text-secondary)]"
            style={{ background: "rgba(199,91,91,0.10)", border: "0.5px solid rgba(199,91,91,0.3)" }}
          >
            <Dot color="var(--danger)" />
            Agent revoked — the session key is zeroed on-chain. Rotate a fresh key to re-enable.
          </div>
        )}
        {agentState === "expired" && (
          <div
            className="mb-5 flex items-center gap-2.5 rounded-xl px-4 py-3 text-[13px] text-[var(--text-secondary)]"
            style={{ background: "rgba(199,91,91,0.10)", border: "0.5px solid rgba(199,91,91,0.3)" }}
          >
            <Dot color="var(--danger)" />
            Agent expired — transfers are blocked. Restore the session for seven more days or rotate the key in Advanced.
          </div>
        )}
        {agentState === "paused" && (
          <div
            className="mb-5 flex items-center gap-2.5 rounded-xl px-4 py-3 text-[13px] text-[var(--text-secondary)]"
            style={{ background: "rgba(199,91,91,0.10)", border: "0.5px solid rgba(199,91,91,0.3)" }}
          >
            <Dot color="var(--danger)" />
            Agent paused — transfers are blocked until you unpause. The session key is still registered.
          </div>
        )}

        {actions.pendingLabel && (
          <div
            role="status"
            aria-live="polite"
            className="mb-5 flex items-center gap-2.5 rounded-xl bg-[var(--bg-card)] px-4 py-3 text-[13px] text-[var(--text-secondary)] [border:0.5px_solid_var(--border-strong)]"
          >
            <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-[var(--text-tertiary)] border-t-[var(--accent)]" />
            {actions.pendingLabel} — confirm in your wallet, then Aegis settles it on-chain.
          </div>
        )}

        {actions.error && (
          <div
            role="alert"
            className="mb-5 flex items-start justify-between gap-3 rounded-xl bg-[rgba(199,91,91,0.10)] px-4 py-3 text-[13px] leading-[1.45] text-[var(--danger)] [border:0.5px_solid_rgba(199,91,91,0.28)]"
          >
            <span>{actions.error}</span>
            <button
              type="button"
              onClick={actions.clearError}
              aria-label="Dismiss error"
              className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--danger)]"
            >
              <IconX size={14} />
            </button>
          </div>
        )}

        <div className="mb-5 inline-flex rounded-lg bg-[var(--bg-elevated)] p-0.5 [border:0.5px_solid_var(--border)]">
          <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
            Overview
          </TabButton>
          <TabButton active={tab === "advanced"} onClick={() => setTab("advanced")}>
            Advanced
          </TabButton>
        </div>

        {tab === "overview" ? (
          <>
            <VaultCard
              policy={policy}
              onFund={(amount) =>
                run(actionKeys.fund, () => provider.fundVault(amount), {
                  label: "Adding funds to the vault",
                  fallback: "Could not add funds to the vault.",
                  success: "Vault funded.",
                })
              }
              onWithdraw={(amount) =>
                run(actionKeys.withdraw, () => provider.withdrawVault(amount), {
                  label: "Withdrawing from the vault",
                  fallback: "Could not withdraw from the vault.",
                  success: "Withdrawn to your wallet.",
                })
              }
            />

            <SpendCard policy={policy} now={now} />

            <div className="mt-4">
              <SessionCard policy={policy} agentState={agentState} now={now} showActions={false} />
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
              <CapsCard
                policy={policy}
                onSave={(patch) =>
                  run(
                    patch.maxPerTx !== undefined ? actionKeys.maxPerTx : actionKeys.dailyLimit,
                    () => provider.updatePolicy(patch),
                    {
                      label: "Updating your caps",
                      fallback: "Policy update failed.",
                      success: "Caps updated on-chain.",
                    },
                  )
                }
              />
              <SessionCard
                policy={policy}
                agentState={agentState}
                now={now}
                onRotate={() => {
                  run(actionKeys.rotate, () => provider.rotateAgent(), {
                    label: "Rotating the session key",
                    fallback: "Rotate failed.",
                    success: "Session key rotated.",
                  });
                }}
                onUpdateExpiry={(expiryTs) => {
                  run(actionKeys.expiry, () => provider.updatePolicy({ expiryTs }), {
                    label: "Extending the session",
                    fallback: "Expiry update failed.",
                    success: "Session extended.",
                  });
                }}
              />
            </div>

            <TokenEnvelopeCard
              policy={policy}
              now={now}
              onConfigure={(config) =>
                run(actionKeys.configureToken, () => provider.configureToken(config), {
                  label: "Configuring the token envelope",
                  fallback: "Token configuration failed.",
                  success: "Token envelope configured.",
                })
              }
              onPrepareAccounts={() => {
                run(
                  actionKeys.prepareAccounts,
                  () => provider.prepareTokenAccounts(addressBook.map((entry) => entry.address)),
                  {
                    label: "Preparing token accounts",
                    fallback: "Token account setup failed.",
                    success: "Token accounts ready.",
                  },
                );
              }}
              onDemoStock={(symbol) => {
                run(actionKeys.demoStock, async () => {
                  await requestDemoStock();
                  // The faucet runs outside the provider; re-pull so the new
                  // balance shows now rather than on the next poll.
                  await provider.refresh?.();
                }, {
                  label: `Adding demo ${symbol} to your vault`,
                  fallback: "The demo faucet failed.",
                  success: `Added $1,000 of demo ${symbol} to your vault. Try "buy $40 ${symbol.toLowerCase()}".`,
                });
              }}
            />

            <Card className="mt-4 p-5">
              <Label>Policy lists</Label>
              <p className="mb-4 mt-2 text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
                Aegis enforces transfer recipients and the configured token mint. Program and mint lists currently feed swap previews only.
              </p>
              <div className="flex flex-col gap-5">
                <AllowList
                  kind="programs"
                  title="Swap programs"
                  hint="Preview only · not enforced by current transfers"
                  addresses={policy.allowedPrograms}
                  labeler={programLabel}
                  onAdd={addToAllowList}
                  onRemove={removeFromAllowList}
                />
                <AllowList
                  kind="mints"
                  title="Swap mints"
                  hint="Preview only · not enforced by current transfers"
                  addresses={policy.allowedMints}
                  labeler={mintLabel}
                  quickAdd={mintQuickAdd}
                  onAdd={addToAllowList}
                  onRemove={removeFromAllowList}
                />
                <AllowList
                  kind="recipients"
                  title="Transfer recipients"
                  hint="Enforced by Aegis · empty allows any recipient"
                  addresses={policy.allowedRecipients}
                  emptyMeansAny
                  onAdd={addToAllowList}
                  onRemove={removeFromAllowList}
                />
              </div>
            </Card>

            <AddressBookCard
              onAdd={(label, address) => {
                run(actionKeys.addContact, () => provider.addContact(label, address), {
                  label: "Saving the contact",
                  fallback: "Could not save this contact.",
                  success: `Saved "${label}".`,
                });
              }}
              onRemove={(key) => {
                run(actionKeys.removeContact(key), () => provider.removeContact(key), {
                  label: "Removing the contact",
                  fallback: "Could not remove this contact.",
                  success: "Contact removed.",
                });
              }}
            />

            <DangerZone
              policy={policy}
              onDelete={() =>
                run(actionKeys.deleteAgent, () => provider.deleteAgent(), {
                  label: "Deleting the agent and closing the vault",
                  fallback: "Could not delete the agent.",
                  success: "Agent deleted and vault closed.",
                })
              }
            />
          </>
        )}

        {revokeOpen && (
          <RevokeDialog onConfirm={() => provider.revokeAgent()} onClose={() => setRevokeOpen(false)} />
        )}
      </Surface>
    </AsyncActionProvider>
  );
}

// --- address book (labels resolve names in chat; no signing power) ---
function AddressBookCard({
  onAdd,
  onRemove,
}: {
  onAdd: (label: string, address: string) => void;
  onRemove: (key: string) => void;
}) {
  const book = useAddressBook();
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const { busy, pendingKey } = useActionState();

  const add = () => {
    if (!label.trim() || !address.trim() || busy) return;
    onAdd(label.trim(), address.trim());
    setLabel("");
    setAddress("");
  };

  return (
    <Card className="mt-4 p-5">
      <div className="mb-1 flex items-baseline justify-between">
        <Label>Address book</Label>
        <span className="[font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
          labels only — no signing power
        </span>
      </div>
      <p className="mb-4 text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
        Say <span className="[font-family:var(--font-mono)] text-[var(--text-primary)]">send 1 SOL to maya</span> instead
        of pasting addresses. You can also ask the agent to save one in chat.
      </p>

      {book.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {book.map((entry) => (
            <div
              key={entry.address}
              className="flex items-center gap-3 rounded-lg bg-[var(--bg)] px-3 py-2 [border:0.5px_solid_var(--border)]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                  {entry.name}
                </div>
                <div className="truncate [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
                  {entry.label} · {shortenAddress(entry.address)}
                </div>
              </div>
              <button
                type="button"
                aria-label={`Remove ${entry.name}`}
                disabled={busy}
                onClick={() => onRemove(entry.address)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pendingKey === actionKeys.removeContact(entry.address) ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                ) : (
                  <IconX size={13} />
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="name (maya)"
          aria-label="Contact name"
          className="h-9 w-[130px] shrink-0 rounded-md bg-[var(--bg)] px-2.5 text-[12px] text-[var(--text-primary)] outline-none [border:0.5px_solid_var(--border)] placeholder:text-[var(--text-tertiary)] focus:[border-color:var(--border-bright)]"
        />
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="paste address…"
          aria-label="Contact address"
          className="h-9 min-w-0 flex-1 rounded-md bg-[var(--bg)] px-2.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-primary)] outline-none [border:0.5px_solid_var(--border)] placeholder:text-[var(--text-tertiary)] focus:[border-color:var(--border-bright)]"
        />
        <button
          type="button"
          onClick={add}
          disabled={!label.trim() || !address.trim() || busy}
          aria-label="Save contact"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--accent)] [border:0.5px_solid_var(--border)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pendingKey === actionKeys.addContact ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          ) : (
            <IconPlus size={15} />
          )}
        </button>
      </div>
    </Card>
  );
}

// --- danger zone (delete agent) ---
function DangerZone({
  policy,
  onDelete,
}: {
  policy: PolicyView;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [confirming, setConfirming] = useState(false);
  // Whether the delete we are showing an error for is OURS. The action error
  // is shared across the whole dashboard, so without this the dialog would
  // open displaying whatever unrelated action failed last.
  const [deleteFailed, setDeleteFailed] = useState(false);
  const { busy, pendingKey, error } = useActionState();
  const deleting = pendingKey === actionKeys.deleteAgent;
  const tokenConfigured = policy.tokenMint !== SYSTEM_PROGRAM;
  const armed = confirm.trim().toUpperCase() === "DELETE";

  // Typing DELETE arms the control; it does not fire it. The second step is a
  // modal, because the first one can be completed by muscle memory — the word
  // is printed in the placeholder directly above the field — and this is the
  // one action in the product that closes the account. The dialog stays open
  // for the whole wallet round-trip and closes only when the delete lands, so
  // a failure is read next to the button that caused it rather than in a
  // banner at the top of a scrolled page.
  useActionCompletion([actionKeys.deleteAgent], (ok) => {
    setDeleteFailed(!ok);
    if (!ok) return;
    setConfirming(false);
    setConfirm("");
  });

  return (
    <div className="mt-4 rounded-xl bg-[rgba(199,91,91,0.05)] p-5 [border:0.5px_solid_rgba(199,91,91,0.4)]">
      <div className="flex items-center gap-2">
        <IconAlertTriangle size={16} className="text-[var(--danger)]" />
        <Label className="text-[var(--danger)]">Danger zone</Label>
      </div>

      <p className="mt-3 text-[13px] leading-[1.55] text-[var(--text-secondary)]">
        <span className="font-medium text-[var(--text-primary)]">Delete agent &amp; close vault.</span>{" "}
        Returns your vault balance ({formatSol(policy.vaultBalance)} SOL) plus the
        account rent (~0.022 SOL) to your wallet, and wipes this policy on-chain.
        This <span className="font-medium">cannot be undone</span> — you can set up
        a fresh agent afterward.
      </p>

      {tokenConfigured && (
        <div className="mt-3 rounded-md bg-[rgba(199,91,91,0.10)] p-3 text-[12px] leading-[1.5] text-[var(--danger)]">
          You have an SPL token envelope configured. If the vault still holds
          tokens, move them out first — SOL-only teardown for now; the delete
          will be refused while tokens remain.
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <input
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder="Type DELETE to confirm"
          aria-label="Type DELETE to confirm deletion"
          className="h-9 flex-1 rounded-md bg-[var(--bg)] px-3 text-[13px] text-[var(--text-primary)] [border:0.5px_solid_var(--border)] outline-none focus:[border-color:var(--danger)]"
        />
        <button
          type="button"
          disabled={!armed || busy}
          onClick={() => {
            setDeleteFailed(false);
            setConfirming(true);
          }}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-4 text-[13px] font-medium text-[var(--danger)] [border:0.5px_solid_rgba(199,91,91,0.4)] [transition:background_0.15s] hover:bg-[rgba(199,91,91,0.12)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {deleting ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          ) : (
            <IconTrash size={15} />
          )}
          {deleting ? "Deleting…" : "Delete agent"}
        </button>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Delete this agent and close the vault?"
          confirmLabel="Delete agent"
          busyLabel="Deleting…"
          cancelLabel="Keep agent"
          busy={deleting}
          error={deleteFailed && !deleting ? error : null}
          onClose={() => {
            setConfirming(false);
            setDeleteFailed(false);
          }}
          onConfirm={() => {
            setDeleteFailed(false);
            onDelete();
          }}
        >
          <p>
            This wipes your policy on-chain and closes the vault. It{" "}
            <span className="font-medium text-[var(--text-primary)]">cannot be undone</span> —
            revoking the agent is the reversible version of this.
          </p>
          <p className="mt-3">
            Returning to your wallet:{" "}
            <span className="[font-family:var(--font-mono)] text-[var(--text-primary)]">
              {formatSol(policy.vaultBalance)} SOL
            </span>{" "}
            from the vault plus about 0.022 SOL of account rent.
          </p>
          {tokenConfigured && (
            <p className="mt-3 rounded-md bg-[rgba(199,91,91,0.10)] p-3 text-[12.5px] leading-[1.5] text-[var(--danger)]">
              An SPL token envelope is configured. If the vault still holds tokens the
              program will refuse this — move them out first.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

// --- tabs ---
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`rounded-[7px] px-3.5 py-1.5 text-[12.5px] font-medium [transition:background_0.15s,color_0.15s] ${
        active
          ? "bg-[var(--bg-card)] text-[var(--text-primary)] [box-shadow:0_1px_2px_rgba(0,0,0,0.18)]"
          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      }`}
    >
      {children}
    </button>
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
  onSave: (patch: { maxPerTx?: bigint; dailyLimit?: bigint }) => Promise<boolean>;
}) {
  return (
    <Card className="p-5">
      <Label className="mb-4">Caps</Label>
      <div className="flex flex-col gap-4">
        <CapRow
          label="Per transaction"
          value={policy.maxPerTx}
          validate={(v) => (v > policy.dailyLimit ? "Per-transaction cap cannot exceed the daily limit." : undefined)}
          onSave={(v) => onSave({ maxPerTx: v })}
        />
        <div className="h-px bg-[var(--border)]" />
        <CapRow
          label="Daily limit"
          value={policy.dailyLimit}
          validate={(v) => (v < policy.maxPerTx ? "Daily limit cannot be below the per-transaction cap." : undefined)}
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
  onDemoStock,
}: {
  policy: PolicyView;
  now: number;
  onConfigure: (config: TokenEnvelopeConfig) => Promise<boolean>;
  onPrepareAccounts: () => void;
  onDemoStock: (symbol: string) => void;
}) {
  const configured = policy.tokenMint !== SYSTEM_PROGRAM;
  const { stocks, stocksEnabled, activeMint, symbolFor, usesMirrorMints } = useActiveStock();
  const {
    envelopeCandidates,
    unusable,
    loaded: catalogLoaded,
    error: catalogError,
    retry: retryCatalog,
  } = useTokenCatalog();
  const { labelFor, scaleFor } = useTokenMeta();
  const decimals = scaleFor(policy.tokenMint);
  const symbol = labelFor(policy.tokenMint);
  const universeIndex = stocks.findIndex((s) => s.mint === policy.tokenMint);
  const stockEntry = universeIndex >= 0 ? stocks[universeIndex] : undefined;
  // Everything an envelope could actually be pointed at on this cluster: the
  // verified token catalog plus whichever stock mints the server confirmed are
  // movable here. A symbol that fails either check is never offered.
  const pickable = [
    ...envelopeCandidates,
    ...stocks
      .filter((stock) => stock.transferable !== false)
      .map((stock) => ({ symbol: stock.symbol, mint: stock.mint })),
  ];

  // Default caps when (re)selecting a token. A priced stock gets $100 per buy
  // and $500 a day at its PreStocks price — buys are asked for in dollars, and
  // 200 of a four-figure stock is a six-figure cap. Anything else gets 200 /
  // 500 in its own units. Returns null when the scale is unknown — a cap
  // written at the wrong exponent is a wrong cap, so the control is disabled
  // instead.
  const defaultsFor = (mint: string): TokenEnvelopeConfig | null => {
    const scale = scaleFor(mint);
    if (scale === undefined) return null;
    const price = stocks.find((s) => s.mint === mint)?.usdPrice;
    const cap = (usd: number, units: string) =>
      toBaseUnits(
        typeof price === "number" && Number.isFinite(price) && price > 0
          ? (usd / price).toFixed(scale)
          : units,
        scale,
      );
    return {
      tokenMint: mint,
      tokenMaxPerTx: cap(100, "200"),
      tokenDailyLimit: cap(500, "500"),
    };
  };

  const { busy, pendingKey } = useActionState();
  const configuring = pendingKey === actionKeys.configureToken;
  const pick = (mint: string) => {
    if (busy) return;
    const config = defaultsFor(mint);
    if (config) onConfigure(config);
  };
  const activeNeedsSwitch = stocksEnabled && activeMint !== null && activeMint !== policy.tokenMint;
  const activeSymbol = activeMint ? (symbolFor(activeMint) ?? "stock") : null;

  return (
    <Card className="mt-4 p-5">
      <div className="mb-4 flex items-center justify-between">
        <Label>Token transfers (SPL)</Label>
        {configured && (
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--bg-elevated)] px-3 py-1 text-[11px] [border:0.5px_solid_var(--border)]">
            <span className="text-[var(--text-primary)]">
              {symbol}
              {universeIndex >= 0 && (
                <span className="text-[var(--text-tertiary)]">
                  {" "}vault · {universeIndex + 1} of {stocks.length}
                </span>
              )}
            </span>
            <span className="[font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
              {shortenAddress(policy.tokenMint)}
            </span>
          </span>
        )}
      </div>

      {stocksEnabled && (
        <div className="mb-4">
          <StockSwitcher />
          <p className="mt-2 text-[12px] leading-[1.5] text-[var(--text-tertiary)]">
            One vault per stock — the envelope holds a single mint at a time.
            Switching reconfigures caps for that mint; per-mint spend counters
            never mix.
          </p>
        </div>
      )}

      {!configured ? (
        <div>
          {catalogError ? (
            <div className="rounded-md bg-[var(--bg)] p-3 text-[12.5px] leading-[1.45] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)]">
              <div className="flex items-start justify-between gap-3">
                <span>Could not load the mint catalog: {catalogError}</span>
                <button
                  type="button"
                  onClick={retryCatalog}
                  className="inline-flex shrink-0 items-center gap-1 text-[var(--accent)] hover:text-[var(--text-primary)]"
                >
                  <IconRefresh size={12} /> Retry
                </button>
              </div>
            </div>
          ) : pickable.length > 0 ? (
            <>
              <p className="mb-3 text-[13px] text-[var(--text-secondary)]">
                No SPL token configured. Pick one to let the agent move it within its own
                on-chain caps (separate from the SOL envelope).
              </p>
              <div className="flex flex-wrap gap-2">
                {pickable.map((m) => (
                  <button
                    key={m.mint}
                    type="button"
                    disabled={busy}
                    onClick={() => pick(m.mint)}
                    title={`Configure an envelope for ${m.symbol}`}
                    className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)] [border:0.5px_dashed_var(--border-strong)] [transition:color_0.15s] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <IconPlus size={11} />
                    {m.symbol}
                  </button>
                ))}
              </div>
            </>
          ) : !catalogLoaded ? (
            <p className="text-[13px] text-[var(--text-tertiary)]">
              Checking which mints this cluster can move…
            </p>
          ) : (
            // Offering a mint the program can never drive is worse than
            // offering none: it costs a wallet signature to find out.
            <p className="text-[13px] leading-[1.5] text-[var(--text-secondary)]">
              No SPL token is configured, and none of this deployment&rsquo;s mints
              resolve on the cluster Praxis transfers on — so there is nothing
              here an envelope could actually move. Point{" "}
              <span className="[font-family:var(--font-mono)] text-[var(--text-primary)]">
                PRAXIS_TOKENS
              </span>{" "}
              at mints that exist on this cluster.
            </p>
          )}
          {unusable.length > 0 && (
            // Named rather than silently dropped: an operator who pointed
            // PRAXIS_TOKENS at the wrong cluster should be able to see that
            // from the product. The per-symbol reason is on hover, because
            // the reasons differ per mint.
            <p className="mt-3 text-[12px] leading-[1.5] text-[var(--text-tertiary)]">
              Not offered here:{" "}
              {unusable.map((entry, i) => (
                <span key={entry.mint}>
                  {i > 0 && ", "}
                  <span
                    title={entry.reason}
                    className="[font-family:var(--font-mono)] underline decoration-dotted underline-offset-2"
                  >
                    {entry.symbol}
                  </span>
                </span>
              ))}
              . These configured mints don&rsquo;t resolve as SPL Token or Token-2022
              on the cluster Praxis transfers on, so Aegis could never move them.
              Hover a symbol for its specific reason.
            </p>
          )}
          {usesMirrorMints && (
            <p className="mt-3 text-[12px] leading-[1.5] text-[var(--text-tertiary)]">
              Pre-IPO stocks here are demo-cluster stand-ins that mirror the PreStocks
              universe&rsquo;s symbols, decimals and token program. Prices and research come
              from the live PreStocks API; the real mints are mainnet-only.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {activeNeedsSwitch && (
            <button
              type="button"
              disabled={busy}
              onClick={() => activeMint && pick(activeMint)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--accent)] [border:0.5px_solid_var(--border-strong)] [transition:background_0.15s] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {configuring && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              )}
              {configuring ? `Switching to ${activeSymbol}…` : `Switch envelope to ${activeSymbol}`}
            </button>
          )}
          {decimals === undefined ? (
            // Better an honest gap than a confidently wrong number: without the
            // mint's scale, every amount and cap here would be rendered at a
            // guessed exponent.
            <p className="rounded-md bg-[var(--bg)] p-3 text-[12px] leading-[1.5] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)]">
              This envelope&rsquo;s mint isn&rsquo;t one Praxis knows the decimals for, so
              amounts and caps can&rsquo;t be shown accurately. Switch to a listed token, or
              set its decimals server-side.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[var(--text-secondary)]">In vault</span>
                <VaultTokenBalance
                  policy={policy}
                  withUsd
                  className="[font-family:var(--font-mono)] text-[13px] text-[var(--text-primary)]"
                />
              </div>
              <div className="h-px bg-[var(--border)]" />
              <TokenSpend policy={policy} now={now} decimals={decimals} symbol={symbol} />
              <div className="h-px bg-[var(--border)]" />
              <CapRow
                label="Per transaction"
                value={policy.tokenMaxPerTx}
                decimals={decimals}
                unit={symbol}
                usdPrice={stockEntry?.usdPrice}
                validate={(v) => (v > policy.tokenDailyLimit ? "Per-transaction cap cannot exceed the daily limit." : undefined)}
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
                usdPrice={stockEntry?.usdPrice}
                validate={(v) => (v < policy.tokenMaxPerTx ? "Daily limit cannot be below the per-transaction cap." : undefined)}
                onSave={(v) =>
                  onConfigure({
                    tokenMint: policy.tokenMint,
                    tokenMaxPerTx: policy.tokenMaxPerTx,
                    tokenDailyLimit: v,
                  })
                }
              />
            </>
          )}
          <div className="flex items-center gap-2">
            <span className="[font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
              switch token:
            </span>
            {envelopeCandidates
              .filter((m) => m.mint !== policy.tokenMint)
              .map((m) => (
                <button
                  key={m.mint}
                  type="button"
                  disabled={busy}
                  onClick={() => pick(m.mint)}
                  className="rounded-full px-2.5 py-1 [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)] [border:0.5px_dashed_var(--border-strong)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {m.symbol}
                </button>
              ))}
            <button
              type="button"
              disabled={busy}
              onClick={onPrepareAccounts}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pendingKey === actionKeys.prepareAccounts ? (
                <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              ) : (
                <IconWallet size={11} />
              )}
              prepare accounts
            </button>
            {stockEntry?.demoFaucet && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onDemoStock(symbol)}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pendingKey === actionKeys.demoStock ? (
                  <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                ) : (
                  <IconPlus size={11} />
                )}
                $1,000 demo {symbol}
              </button>
            )}
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
  usdPrice,
  validate,
}: {
  label: string;
  value: bigint;
  onSave: (v: bigint) => Promise<boolean>;
  decimals?: number;
  unit?: string;
  /** Price per whole `unit`; shows the cap's dollar value beside it (stocks). */
  usdPrice?: number;
  validate?: (value: bigint) => string | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy } = useActionState();

  const begin = () => {
    // Editable draft must not include thousands separators — formatUnits adds them
    // for display, and a raw "1,000" would fail toBaseUnits on Save.
    setDraft(formatEditableUnits(value, decimals));
    setError(null);
    setEditing(true);
  };

  const commit = async () => {
    if (busy) return;
    let parsed: bigint;
    try {
      parsed = toBaseUnits(draft, decimals);
    } catch {
      setError("Enter a valid amount.");
      return;
    }
    if (parsed <= 0n) {
      setError("Amount must be greater than zero.");
      return;
    }
    const validationError = validate?.(parsed);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    const saved = await onSave(parsed).catch(() => false);
    if (saved) setEditing(false);
    else setError("Not saved. The policy was not changed.");
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-[var(--text-secondary)]">{label}</span>
      {editing ? (
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={draft}
              aria-label={`Edit ${label}`}
              aria-invalid={Boolean(error)}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commit();
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
              onClick={() => void commit()}
              disabled={busy}
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
          {error && (
            <p role="alert" className="max-w-56 text-right text-[11px] leading-[1.35] text-[var(--danger)]">
              {error}
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={begin}
          disabled={busy}
          className="group flex items-center gap-2 [font-family:var(--font-mono)] text-[15px] text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {formatUnits(value, decimals, { maxFrac: 4 })} {unit}
          {usdPrice !== undefined && (
            <span className="text-[12px] text-[var(--text-tertiary)]">
              {formatUsdAmount((Number(value) / 10 ** decimals) * usdPrice)}
            </span>
          )}
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
  agentState,
  now,
  onRotate,
  onUpdateExpiry,
  showActions = true,
}: {
  policy: PolicyView;
  agentState: AgentState;
  now: number;
  onRotate?: () => void;
  onUpdateExpiry?: (expiryTs: number) => void;
  showActions?: boolean;
}) {
  const { busy, pendingKey } = useActionState();
  const extendSevenDays = () => {
    if (!busy) onUpdateExpiry?.(expiryAfterSevenDays(policy.expiryTs, now));
  };
  const inactive = agentState !== "live";
  const statusLabel =
    agentState === "revoked"
      ? "Revoked"
      : agentState === "expired"
        ? "Expired"
        : agentState === "paused"
          ? "Paused"
          : "Live";
  const statusDetail =
    agentState === "revoked"
      ? "key zeroed on-chain"
      : agentState === "expired"
        ? `${shortenAddress(policy.agentAuthority, 6, 6)} · expired`
        : agentState === "paused"
          ? `${shortenAddress(policy.agentAuthority, 6, 6)} · paused`
          : shortenAddress(policy.agentAuthority, 6, 6);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <Label>Session key</Label>
        {showActions && onRotate && (
          <button
            type="button"
            onClick={onRotate}
            disabled={busy}
            className="inline-flex items-center gap-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)] [transition:color_0.15s] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pendingKey === actionKeys.rotate ? (
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
            ) : (
              <IconRefresh size={12} />
            )}
            {pendingKey === actionKeys.rotate ? "rotating…" : "rotate"}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)]">
          <IconKey size={15} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Dot color={inactive ? "var(--danger)" : "var(--success)"} pulse={!inactive} />
            <span className="text-[13px] font-medium">{statusLabel}</span>
          </div>
          <div className="truncate [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
            {statusDetail}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-[13px]">
        <span className="text-[var(--text-secondary)]">Expires</span>
        <div className="flex items-center gap-2">
          <span className="[font-family:var(--font-mono)] text-[var(--text-primary)]">
            {formatExpiry(policy.expiryTs, now)}
          </span>
          {showActions && onUpdateExpiry && (
            <button
              type="button"
              onClick={extendSevenDays}
              disabled={busy}
              className="rounded-md px-2 py-1 [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pendingKey === actionKeys.expiry ? "extending…" : "extend 7d"}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// --- vault ---
function VaultCard({
  policy,
  onFund,
  onWithdraw,
}: {
  policy: PolicyView;
  onFund: (amount: bigint) => void;
  onWithdraw: (amount: bigint) => void;
}) {
  const [mode, setMode] = useState<"fund" | "withdraw" | null>(null);
  const [draft, setDraft] = useState("");
  const { busy, pendingKey } = useActionState();
  const submitting = pendingKey === actionKeys.fund || pendingKey === actionKeys.withdraw;
  const parsed = parseFundAmount(draft);
  // Close the panel once the transfer actually lands; on failure keep it open
  // so the amount is still in context next to the error.
  useActionCompletion([actionKeys.fund, actionKeys.withdraw], (ok) => {
    if (ok) setMode(null);
  });
  // The vault is a data-less system account, so the chain refuses to leave it
  // funded below its rent reserve. Aegis is the authority on that; catching it
  // here just saves a wallet signature and a fee on a transaction that cannot
  // land. A full sweep is always fine — the account is simply deallocated.
  const rentTrap =
    parsed !== null
    && (mode === "withdraw"
      ? parsed < policy.vaultBalance
        && policy.vaultBalance - parsed < VAULT_RENT_RESERVE_LAMPORTS
      : policy.vaultBalance + parsed < VAULT_RENT_RESERVE_LAMPORTS);
  const overBalance = mode === "withdraw" && parsed !== null && parsed > policy.vaultBalance;
  const valid = parsed !== null && !overBalance && !rentTrap;

  const open = (next: "fund" | "withdraw") => {
    setMode((current) => (current === next ? null : next));
    setDraft("");
  };

  const submit = () => {
    if (!valid || parsed === null || mode === null || busy) return;
    (mode === "fund" ? onFund : onWithdraw)(parsed);
    // Keep the form open and disabled until the action settles: closing it
    // immediately is what made a multi-second wallet round-trip look like
    // nothing had happened.
  };

  return (
    <Card className="p-5">
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
          <VaultTokenBalance
            policy={policy}
            withUsd
            className="mt-1 block [font-family:var(--font-mono)] text-[12px] text-[var(--text-secondary)]"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => open("fund")}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] [border:0.5px_solid_var(--border)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === "fund" ? "text-[var(--accent)]" : "text-[var(--text-tertiary)]"
              }`}
            >
              <IconPlus size={12} /> Add funds
            </button>
            <button
              type="button"
              onClick={() => open("withdraw")}
              disabled={busy || policy.vaultBalance === 0n}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] [border:0.5px_solid_var(--border)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === "withdraw" ? "text-[var(--accent)]" : "text-[var(--text-tertiary)]"
              }`}
            >
              <IconArrowUp size={12} /> Withdraw
            </button>
          </div>
        </div>
      </div>

      {mode && (
        <div className="mt-4 [border-top:0.5px_solid_var(--border)] pt-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                autoFocus
                inputMode="decimal"
                value={draft}
                disabled={busy}
                aria-label={mode === "withdraw" ? "Withdraw amount in SOL" : "Fund amount in SOL"}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && submit()}
                placeholder={mode === "withdraw" ? formatSol(policy.vaultBalance) : "0.5"}
                className="h-9 w-full rounded-md bg-[var(--bg)] pl-3 pr-12 text-[13px] text-[var(--text-primary)] [border:0.5px_solid_var(--border)] outline-none focus:[border-color:var(--accent)]"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-tertiary)]">
                SOL
              </span>
            </div>
            {mode === "withdraw" && (
              <button
                type="button"
                // Exact, not rounded: "Max" means all of it, and a rounded
                // figure would leave dust the chain refuses to strand.
                onClick={() => setDraft(formatEditableUnits(policy.vaultBalance, 9))}
                className="h-9 rounded-md px-2 text-[11px] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)] hover:text-[var(--accent)]"
              >
                Max
              </button>
            )}
            <Button onClick={submit} disabled={!valid || busy}>
              {submitting && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              )}
              {mode === "fund" ? "Deposit" : "Withdraw"}
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-[1.5] text-[var(--text-tertiary)]">
            {overBalance
              ? "Amount exceeds the vault balance."
              : rentTrap
                ? mode === "withdraw"
                  ? `A partial withdrawal has to leave ${formatSol(VAULT_RENT_RESERVE_LAMPORTS, 9)} SOL behind to keep the vault rent-exempt. Use Max to empty it.`
                  : `A vault needs at least ${formatSol(VAULT_RENT_RESERVE_LAMPORTS, 9)} SOL to exist on-chain.`
                : mode === "fund"
                  ? "Moves SOL from your wallet into the agent vault."
                  : "Returns SOL from the vault to your wallet. Owner-only — no policy limits apply."}
          </p>
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
  const { busy, pendingKey } = useActionState();

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
    if (!address.trim() || busy) return;
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
                disabled={busy}
                onClick={() => {
                  if (!busy) onRemove(kind, a);
                }}
                className="flex h-4 w-4 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-card)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pendingKey === actionKeys.allowList(kind, a, "remove") ? (
                  <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                ) : (
                  <IconX size={11} />
                )}
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
            disabled={busy}
            onClick={() => add(q.address)}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)] [border:0.5px_dashed_var(--border-strong)] [transition:color_0.15s] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pendingKey === actionKeys.allowList(kind, q.address, "add") ? (
              <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
            ) : (
              <IconPlus size={11} />
            )}
            {q.label}
          </button>
        ))}
        <div className="flex items-center gap-1.5">
          <input
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add(draft);
            }}
            placeholder="paste address…"
            aria-label="Paste address to add to allow-list"
            className="w-[150px] rounded-md bg-[var(--bg)] px-2.5 py-1 [font-family:var(--font-mono)] text-[11px] text-[var(--text-primary)] outline-none [border:0.5px_solid_var(--border)] placeholder:text-[var(--text-tertiary)] focus:[border-color:var(--border-bright)]"
          />
          {draft.trim() && (
            <button
              type="button"
              disabled={busy}
              onClick={() => add(draft)}
              aria-label="Add address"
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--accent)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-40"
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

/**
 * Devnet demo only: mint mirror stock into the signed-in wallet's vault, so a
 * wallet other than the operator's can complete a buy. Not on the provider
 * interface — it is a property of a demo deployment, not of Praxis.
 */
async function requestDemoStock(): Promise<void> {
  const res = await fetch("/api/praxis/demo-faucet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (res.ok) return;
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(typeof body?.error === "string" ? body.error : "The demo faucet failed.");
}
