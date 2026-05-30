"use client";

import { AppShell } from "./AppShell";
import { ApiAuthGate } from "./AuthGate";
import { ProviderProvider } from "./ProviderContext";
import { useIsClient } from "./lib/useNow";
import { resolveProviderMode } from "./providerMode";

/**
 * Client root for the Praxis product app. Owns the single provider instance.
 *
 * The client guard keeps SSR + first hydration deterministic: the mock seeds
 * relative timestamps from `Date.now()`, so we render a static skeleton until
 * the client has mounted, then swap in the live app — no hydration mismatch.
 */
export function PraxisApp() {
  const isClient = useIsClient();

  if (!isClient) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-[var(--bg)]">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--text-primary)] [font-family:var(--font-mono)] text-[16px] font-medium text-[var(--bg)] [animation:pulse_2s_infinite]">
          P
        </span>
      </div>
    );
  }

  const mode = resolveProviderMode();
  if (mode === "mock-disabled") {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--bg)] px-6">
        <div className="w-full max-w-[460px] rounded-lg bg-[var(--bg-card)] p-6 [border:0.5px_solid_var(--border-strong)]">
          <h1 className="[font-family:var(--font-serif)] text-[26px] leading-none text-[var(--text-primary)]">
            Praxis API mode required
          </h1>
          <p className="mt-3 text-[13.5px] leading-[1.6] text-[var(--text-secondary)]">
            Mock provider mode is disabled in production. Set
            {" "}
            <span className="[font-family:var(--font-mono)] text-[var(--text-primary)]">
              NEXT_PUBLIC_PRAXIS_PROVIDER=api
            </span>
            {" "}
            and configure the live backend before deploying.
          </p>
        </div>
      </div>
    );
  }

  const app = (
    <ProviderProvider>
      <AppShell />
    </ProviderProvider>
  );

  if (mode === "api") {
    return <ApiAuthGate>{app}</ApiAuthGate>;
  }

  return app;
}
