"use client";

/**
 * The one place that knows which provider implementation is live. Swap
 * `MockPraxisProvider` for a real backend client here and nothing else changes —
 * every surface reads through the {@link PraxisProvider} interface below.
 */

import type {
  ActionProposal,
  ActivityEntry,
  AddressBookEntry,
  DcaScheduleView,
  PolicyView,
  ProviderConnectionState,
  PraxisProvider,
  Thread,
} from "@praxis/shared";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { MockPraxisProvider } from "./mock/mockProvider";
import { useAuthSession } from "./AuthGate";
import { resolveProviderMode } from "./providerMode";
import { RemotePraxisProvider } from "./remoteProvider";

const Ctx = createContext<PraxisProvider | null>(null);

export function ProviderProvider({ children }: { children: ReactNode }) {
  const auth = useAuthSession();
  const [provider] = useState<PraxisProvider>(() => {
    const mode = resolveProviderMode();
    return mode === "api"
      ? new RemotePraxisProvider(() => auth?.invalidateSession())
      : new MockPraxisProvider();
  });

  // The remote provider polls; tie that to the component's lifetime so signing
  // out actually stops it. Without this the interval outlived every unmount
  // and kept hitting the API with a dead session.
  useEffect(() => {
    if (!(provider instanceof RemotePraxisProvider)) return;
    return provider.start();
  }, [provider]);

  return <Ctx.Provider value={provider}>{children}</Ctx.Provider>;
}

export function useProvider(): PraxisProvider {
  const p = useContext(Ctx);
  if (!p) throw new Error("useProvider must be used inside <ProviderProvider>");
  return p;
}

/** Subscribe to store changes and read a derived slice on every commit. */
export function useStore<T>(select: (p: PraxisProvider) => T): T {
  const p = useProvider();
  useSyncExternalStore(p.subscribe, p.getVersion, p.getVersion);
  return select(p);
}

// --- ergonomic slice hooks ---
export const usePolicy = (): PolicyView => useStore((p) => p.getPolicy());
export const useActivity = (): ActivityEntry[] => useStore((p) => p.getActivity());
export const useThreads = (): Thread[] => useStore((p) => p.getThreads());
export const useThread = (id: string): Thread | undefined =>
  useStore((p) => p.getThread(id));
export const useProposal = (id: string): ActionProposal | undefined =>
  useStore((p) => p.getProposal(id));
export const useThinking = (id: string): boolean => useStore((p) => p.isThinking(id));
export const useAddressBook = (): AddressBookEntry[] =>
  useStore((p) => p.getAddressBook());
export const useSchedules = (): DcaScheduleView[] =>
  useStore((p) => p.getSchedules());
export const useConnectionState = (): ProviderConnectionState =>
  useStore((p) => p.getConnectionState());
