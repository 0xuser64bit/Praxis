"use client";

/**
 * A destructive confirmation, on the shared {@link Modal}.
 *
 * Revoke and delete are the two actions in the product that cannot be undone
 * by clicking again, and they deserve the same shape: a backdrop, an escape
 * hatch that is the default focus, an error that lands next to the button that
 * caused it, and no way to dismiss mid-signature — a wallet prompt is already
 * open at that point and closing the dialog would orphan it.
 *
 * Presentational on purpose. It owns no async state: the caller decides what
 * `busy` and `error` mean, because one of the two callers runs the action
 * itself and the other hands it to the dashboard's shared action queue.
 */

import { IconAlertTriangle } from "@tabler/icons-react";
import { useId, type ReactNode } from "react";

import { Button } from "@/components/praxis/Button";
import { Modal } from "./ui";

export function ConfirmDialog({
  title,
  confirmLabel,
  busyLabel,
  cancelLabel = "Cancel",
  busy = false,
  error,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  confirmLabel: string;
  /** Label while the action is in flight; defaults to `confirmLabel`. */
  busyLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();

  return (
    <Modal onDismiss={onClose} busy={busy} labelledBy={`${id}-title`} describedBy={`${id}-desc`}>
      <div className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--danger)]"
          style={{ background: "rgba(199,91,91,0.16)" }}
        >
          <IconAlertTriangle size={18} />
        </span>
        <h2
          id={`${id}-title`}
          className="[font-family:var(--font-serif)] text-[22px] leading-[1.15] tracking-[-0.01em]"
        >
          {title}
        </h2>
      </div>

      <div
        id={`${id}-desc`}
        className="mt-4 text-[14px] leading-[1.6] text-[var(--text-secondary)]"
      >
        {children}
      </div>

      <div className="mt-6 flex gap-2.5">
        <Button
          variant="default"
          className="flex-1 justify-center py-[11px] min-h-11"
          onClick={onClose}
          disabled={busy}
          autoFocus
        >
          {cancelLabel}
        </Button>
        <Button
          variant="danger"
          className="flex-1 justify-center py-[11px] min-h-11"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          )}
          {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-[rgba(199,91,91,0.1)] px-3 py-2 text-[12px] leading-[1.45] text-[var(--danger)] [border:0.5px_solid_rgba(199,91,91,0.28)]"
        >
          {error}
        </p>
      )}
    </Modal>
  );
}
