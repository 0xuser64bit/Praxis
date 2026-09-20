"use client";

/**
 * Confirmation for the kill switch. Revoking zeroes the agent's session key
 * on-chain in one transaction — the next agent action fails immediately.
 */

import { useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog";
import { messageFromError } from "./lib/useAsyncAction";

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
    <ConfirmDialog
      title="Revoke the agent?"
      confirmLabel="Revoke agent"
      busyLabel="Revoking…"
      cancelLabel="Keep agent"
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={async () => {
        setBusy(true);
        setError(null);
        try {
          await onConfirm();
          onClose();
        } catch (err) {
          setError(messageFromError(err, "Revoke failed."));
        } finally {
          setBusy(false);
        }
      }}
    >
      This zeroes the agent&rsquo;s session key on-chain in a single transaction. Its very next
      action will fail. Your funds stay in the vault; only the agent loses signing power. You can
      rotate in a fresh key at any time.
    </ConfirmDialog>
  );
}
