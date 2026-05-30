"use client";

import { AppShell } from "./AppShell";
import { ApiAuthGate } from "./AuthGate";
import { ProviderProvider } from "./ProviderContext";
import { useIsClient } from "./lib/useNow";

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

  const app = (
    <ProviderProvider>
      <AppShell />
    </ProviderProvider>
  );

  if (process.env.NEXT_PUBLIC_PRAXIS_PROVIDER === "api") {
    return <ApiAuthGate>{app}</ApiAuthGate>;
  }

  return app;
}
