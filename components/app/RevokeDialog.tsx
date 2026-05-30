"use client";

/**
 * Confirmation for the kill switch. Revoking zeroes the agent's session key
 * on-chain in one transaction — the next agent action fails immediately.
 */

import { IconAlertTriangle } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/praxis/Button";

export function RevokeDialog({
  onConfirm,
  onClose,
}: {
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(0,0,0,0.6)] px-6 backdrop-blur-[2px] [animation:fadeUp_0.2s_ease]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Revoke agent"
    >
      <div
        className="w-full max-w-[420px] rounded-2xl bg-[var(--bg-card)] p-6 [border:0.5px_solid_var(--border-strong)] [box-shadow:0_40px_100px_-30px_rgba(0,0,0,0.8)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--danger)]"
            style={{ background: "rgba(199,91,91,0.16)" }}
          >
            <IconAlertTriangle size={18} />
          </span>
          <h2 className="[font-family:var(--font-serif)] text-[22px] tracking-[-0.01em]">
            Revoke the agent?
          </h2>
        </div>

        <p className="mt-4 text-[14px] leading-[1.6] text-[var(--text-secondary)]">
          This zeroes the agent&rsquo;s session key on-chain in a single transaction. Its very next
          action will fail. Your funds stay in the vault; only the agent loses signing power. You can
          rotate in a fresh key at any time.
        </p>

        <div className="mt-6 flex gap-2.5">
          <Button
            variant="default"
            className="flex-1 justify-center py-[11px]"
            onClick={onClose}
            disabled={busy}
          >
            Keep agent
          </Button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Revoke failed.");
              } finally {
                setBusy(false);
              }
            }}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg py-[11px] text-[14px] font-medium text-white [transition:opacity_0.15s] disabled:opacity-60"
            style={{ background: "var(--danger)" }}
          >
            {busy ? "Revoking…" : "Revoke agent"}
          </button>
        </div>
        {error && (
          <p className="mt-3 rounded-lg bg-[rgba(199,91,91,0.1)] px-3 py-2 text-[12px] leading-[1.45] text-[var(--danger)] [border:0.5px_solid_rgba(199,91,91,0.28)]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
