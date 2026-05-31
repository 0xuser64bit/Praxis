"use client";

/**
 * A proposed action rendered as a transaction preview — the landing's tx-card
 * visual language, made interactive and fronted by the {@link PolicyCheckBanner}.
 * The agent proposes; the chain (Aegis) disposes; the owner signs only what the
 * policy already cleared.
 */

import type { ActionProposal, ProposalDetail } from "@praxis/shared";
import {
  IconArrowRight,
  IconCheck,
  IconExternalLink,
  IconShieldCog,
} from "@tabler/icons-react";
import { Fragment, useState, type ReactNode } from "react";

import { Button } from "@/components/praxis/Button";
import { Eyebrow } from "@/components/praxis/Eyebrow";

import { PolicyCheckBanner } from "./PolicyCheckBanner";
import { useProposal, useProvider } from "./ProviderContext";
import { formatUnits, formatUsd, shortenAddress } from "./lib/units";

type Flow = { label: string; primary: string; unit?: string; sub: string; compact?: boolean };
type Meta = { label: string; value: ReactNode; ok?: boolean; mono?: boolean };

export function ProposalCard({
  proposalId,
  onOpenPolicy,
}: {
  proposalId: string;
  onOpenPolicy?: () => void;
}) {
  const proposal = useProposal(proposalId);
  const provider = useProvider();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "sign" | "cancel">(null);
  if (!proposal) return null;

  const { from, to, meta } = describe(proposal.detail, proposal);
  const status = proposal.state === "blocked" && proposal.detail.kind === "swap"
    ? SWAP_BLOCKED_STATUS
    : STATUS[proposal.state];
  const blockedMessage = proposal.detail.kind === "swap"
    ? "Swaps are preview-only in v0.1. Nothing was signed."
    : "The agent can't sign this — the chain would reject it.";
  const runAction = (kind: "sign" | "cancel", action: () => Promise<void>, fallback: string) => {
    setError(null);
    setBusy(kind);
    // The provider call is a full server round-trip (Aegis simulate + submit),
    // so flip a local busy state the instant the button is clicked — the user
    // sees their click register immediately instead of a dead button. The
    // proposal state then transitions (signing → signed/blocked) and this card
    // re-renders out of the pending branch; on failure we clear busy so the
    // buttons become live again.
    void action()
      .catch((err) => {
        setError(messageFromError(err, fallback));
      })
      .finally(() => {
        setBusy(null);
      });
  };

  return (
    <div className="mt-2 rounded-xl bg-[var(--bg)] px-6 py-[22px] [border:0.5px_solid_var(--border-strong)]">
      <div className="mb-[22px] flex items-center justify-between">
        <Eyebrow>Transaction preview</Eyebrow>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 [font-family:var(--font-mono)] text-[10px] tracking-[0.08em] uppercase"
          style={{ background: status.tint, color: status.color }}
        >
          <span aria-hidden className="h-[5px] w-[5px] rounded-full" style={{ background: status.color }} />
          {status.label}
        </span>
      </div>

      {/* from → to */}
      <div className="mb-[18px] grid grid-cols-[1fr_auto_1fr] items-center gap-5 pb-[22px] [border-bottom:0.5px_solid_var(--border)] max-[760px]:grid-cols-1 max-[760px]:justify-items-start max-[760px]:gap-[14px]">
        <FlowCol flow={from} />
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)] max-[760px]:rotate-90">
          <IconArrowRight size={16} />
        </div>
        <FlowCol flow={to} />
      </div>

      {/* simulation meta */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
        {meta.map((row) => (
          <Fragment key={row.label}>
            <dt className="[font-family:var(--font-mono)] text-[12px] text-[var(--text-tertiary)]">
              {row.label}
            </dt>
            <dd
              className={[
                row.ok ? "text-[var(--success)]" : "text-[var(--text-primary)]",
                row.mono ? "[font-family:var(--font-mono)] text-[12px]" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {row.ok && <IconCheck size={14} className="inline" style={{ verticalAlign: -2 }} />} {row.value}
            </dd>
          </Fragment>
        ))}
      </dl>

      {/* the verdict */}
      <PolicyCheckBanner proposal={proposal} />

      {/* state-dependent actions */}
      <div className="mt-[18px]">
        {proposal.state === "pending" && (
          <div className="flex gap-2.5">
            <Button
              variant="primary"
              className="flex-1 justify-center px-3.5 py-[11px]"
              disabled={busy !== null}
              onClick={() => {
                runAction("sign", () => provider.signProposal(proposal.id), "Signing failed.");
              }}
            >
              {busy === "sign" ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-[var(--bg)] border-t-transparent" />
                  Submitting…
                </>
              ) : (
                <>
                  Confirm &amp; sign
                  <IconArrowRight size={14} />
                </>
              )}
            </Button>
            <Button
              className="flex-1 justify-center px-3.5 py-[11px]"
              disabled={busy !== null}
              onClick={() => {
                runAction("cancel", () => provider.cancelProposal(proposal.id), "Cancel failed.");
              }}
            >
              Cancel
            </Button>
          </div>
        )}

        {proposal.state === "signing" && (
          <div className="flex items-center justify-center gap-2.5 rounded-lg bg-[var(--bg-elevated)] py-[11px] [font-family:var(--font-mono)] text-[13px] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)]">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-[var(--text-tertiary)] border-t-[var(--accent)]" />
            Submitting through Aegis…
          </div>
        )}

        {proposal.state === "signed" && (
          <div className="flex items-center gap-3 rounded-lg bg-[var(--bg-elevated)] px-3.5 py-3 [border:0.5px_solid_var(--border)]">
            <span
              aria-hidden
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[var(--success)]"
              style={{ background: "rgba(127, 176, 105, 0.12)" }}
            >
              <IconCheck size={13} />
            </span>
            <div className="flex-1 text-[13px]">
              <span className="font-medium">Signed &amp; confirmed</span>
              <div className="mt-0.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
                {proposal.sig ? shortenAddress(proposal.sig, 6, 6) : "—"} · confirmed in 0.9s
              </div>
            </div>
            <span
              aria-label="Explorer link unavailable for local demo signatures"
              className="text-[var(--text-tertiary)]"
            >
              <IconExternalLink size={14} />
            </span>
          </div>
        )}

        {proposal.state === "blocked" && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--bg-elevated)] px-3.5 py-3 [border:0.5px_solid_var(--border)]">
            <span className="text-[13px] text-[var(--text-secondary)]">
              {blockedMessage}
            </span>
            {onOpenPolicy && (
              <Button size="sm" className="shrink-0" onClick={onOpenPolicy}>
                <IconShieldCog size={14} />
                Review policy
              </Button>
            )}
          </div>
        )}

        {proposal.state === "cancelled" && (
          <div className="rounded-lg bg-[var(--bg-elevated)] px-3.5 py-3 text-[13px] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)]">
            Cancelled — nothing was signed.
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg bg-[rgba(199,91,91,0.10)] px-3 py-2 text-[12px] leading-[1.45] text-[var(--danger)] [border:0.5px_solid_rgba(199,91,91,0.28)]">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS: Record<ActionProposal["state"], { label: string; color: string; tint: string }> = {
  pending: { label: "Awaiting signature", color: "var(--accent)", tint: "var(--accent-dim)" },
  signing: { label: "Signing", color: "var(--accent)", tint: "var(--accent-dim)" },
  signed: { label: "Confirmed", color: "var(--success)", tint: "rgba(127,176,105,0.14)" },
  blocked: { label: "Blocked by Aegis", color: "var(--danger)", tint: "rgba(199,91,91,0.16)" },
  cancelled: { label: "Cancelled", color: "var(--text-tertiary)", tint: "var(--bg-elevated)" },
};
const SWAP_BLOCKED_STATUS = { label: "Preview only", color: "var(--danger)", tint: "rgba(199,91,91,0.16)" };

function FlowCol({ flow }: { flow: Flow }) {
  const sizeClass = flow.compact ? "text-[28px]" : "text-[36px]";
  return (
    <div className="min-w-0">
      <div className="mb-1.5 [font-family:var(--font-mono)] text-[10px] tracking-[0.12em] text-[var(--text-tertiary)] uppercase">
        {flow.label}
      </div>
      <div className={`[font-family:var(--font-serif)] ${sizeClass} leading-none tracking-[-0.02em] truncate`}>
        {flow.primary}
        {flow.unit && <span className="text-[22px] text-[var(--text-tertiary)]"> {flow.unit}</span>}
      </div>
      <div className="mt-1.5 truncate [font-family:var(--font-mono)] text-[12px] text-[var(--text-tertiary)]">
        {flow.sub}
      </div>
    </div>
  );
}

function describe(
  detail: ProposalDetail,
  proposal: ActionProposal,
): { from: Flow; to: Flow; meta: Meta[] } {
  const feeUsd = formatUsd(proposal.networkFee, 9, "SOL");
  if (detail.kind === "transfer") {
    return {
      from: {
        label: "Send",
        primary: formatUnits(detail.amount, detail.asset.decimals, { maxFrac: 4 }),
        unit: detail.asset.symbol,
        sub: formatUsd(detail.amount, detail.asset.decimals, detail.asset.symbol),
      },
      to: {
        label: "To",
        primary: detail.recipientName,
        sub: shortenAddress(detail.recipientAddress),
        compact: true,
      },
      meta: [
        { label: "Network fee", value: feeUsd },
        { label: "Simulation", value: proposal.simulation, ok: proposal.check.allowed },
      ],
    };
  }
  return {
    from: {
      label: "You pay",
      primary: formatUnits(detail.amountIn, detail.assetIn.decimals, { maxFrac: 4 }),
      unit: detail.assetIn.symbol,
      sub: formatUsd(detail.amountIn, detail.assetIn.decimals, detail.assetIn.symbol),
    },
    to: {
      label: "You receive",
      primary: formatUnits(detail.estAmountOut, detail.assetOut.decimals, { maxFrac: 4 }),
      unit: detail.assetOut.symbol,
      sub: detail.assetOut.verified
        ? formatUsd(detail.estAmountOut, detail.assetOut.decimals, detail.assetOut.symbol)
        : `${shortenAddress(detail.assetOut.mint)} · unverified`,
    },
    meta: [
      { label: "Route", value: detail.route, mono: true },
      { label: "Price impact", value: `${(detail.priceImpactBps / 100).toFixed(2)}%` },
      { label: "Network fee", value: feeUsd },
      { label: "Simulation", value: proposal.simulation, ok: proposal.check.allowed },
    ],
  };
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
