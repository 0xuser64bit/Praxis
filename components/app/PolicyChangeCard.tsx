"use client";

/**
 * Renders a parsed Aegis policy change. When the backend already applied it
 * (a backend owner key is configured) the card is a confirmation. Otherwise it
 * offers a single "Apply & sign" action that submits the change through the
 * wallet-signed owner-action path — Aegis requires the owner's signature for
 * every policy change, so nothing mutates until the user signs.
 */

import type { PolicyChangeRow, PolicyUpdate } from "@praxis/shared";
import { IconArrowRight, IconCheck, IconShieldCog } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/praxis/Button";

import { useProvider } from "./ProviderContext";

export function PolicyChangeCard({
  patch,
  changes,
  applied,
}: {
  patch: PolicyUpdate;
  changes: PolicyChangeRow[];
  applied: boolean;
}) {
  const provider = useProvider();
  const [done, setDone] = useState(applied);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    setError(null);
    setBusy(true);
    void provider
      .updatePolicy(patch)
      .then(() => setDone(true))
      .catch((err) => setError(err instanceof Error ? err.message : "Policy change failed."))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-2 rounded-xl bg-[var(--bg)] px-5 py-[18px] [border:0.5px_solid_var(--border-strong)]">
      <div className="mb-3.5 flex items-center gap-2 [font-family:var(--font-mono)] text-[10px] tracking-[0.12em] text-[var(--text-tertiary)] uppercase">
        <IconShieldCog size={13} />
        Policy change
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-[13px]">
        {changes.map((row) => (
          <div key={row.label} className="contents">
            <dt className="[font-family:var(--font-mono)] text-[12px] text-[var(--text-tertiary)]">
              {row.label}
            </dt>
            <dd className="flex items-center gap-2 [font-family:var(--font-mono)] text-[12px] text-[var(--text-primary)]">
              <span className="text-[var(--text-tertiary)] line-through">{row.from}</span>
              <IconArrowRight size={13} className="text-[var(--text-tertiary)]" />
              <span className="text-[var(--text-primary)]">{row.to}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-[18px]">
        {done ? (
          <div className="flex items-center gap-2.5 rounded-lg bg-[var(--bg-elevated)] px-3.5 py-3 text-[13px] [border:0.5px_solid_var(--border)]">
            <span
              aria-hidden
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[var(--success)]"
              style={{ background: "rgba(127, 176, 105, 0.12)" }}
            >
              <IconCheck size={13} />
            </span>
            <span className="font-medium text-[var(--text-primary)]">Applied &amp; enforced on-chain</span>
          </div>
        ) : (
          <Button
            variant="primary"
            className="w-full justify-center px-3.5 py-[11px]"
            disabled={busy}
            onClick={apply}
          >
            {busy ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-[var(--bg)] border-t-transparent" />
                Signing…
              </>
            ) : (
              <>
                Apply &amp; sign
                <IconArrowRight size={14} />
              </>
            )}
          </Button>
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
