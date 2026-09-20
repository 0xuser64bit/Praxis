"use client";

/**
 * Which SPL mints this deployment can actually offer, as the server sees them.
 *
 * The client used to hold this list itself — three mainnet addresses, offered
 * on whatever cluster the backend happened to point at. On the devnet demo
 * every one of them is a plain System-owned account, so picking one cost a
 * wallet signature and came back "this mint is owned by 1111…1111, which is
 * neither SPL Token nor Token-2022". Which mints exist is a fact about a
 * cluster, and the browser is not where that fact lives.
 *
 * Mock mode has no cluster at all, so it keeps the static list: the mock
 * provider is the chain there, and it accepts them.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { isApiMode } from "./providerMode";
import {
  QUICK_MINTS,
  TOKEN_ENVELOPE_MINTS,
  mintDecimals,
  mintLabel,
} from "./lib/tokenCatalog";

export type TokenCatalogStatus = "movable" | "wrong-program" | "missing";

export interface TokenCatalogEntry {
  symbol: string;
  mint: string;
  /** Chain-confirmed decimals; `null` when the mint could not be read. */
  decimals: number | null;
  status: TokenCatalogStatus;
  /** Owning program, when `status === "wrong-program"`. */
  programId?: string;
  /** Wrapped SOL: a real mint, but not an SPL-envelope candidate. */
  native?: boolean;
}

interface TokenCatalogApi {
  entries: TokenCatalogEntry[];
  /**
   * False until the server has answered. An empty catalog and an unanswered
   * one look identical, and telling the owner "nothing here works on this
   * cluster" while the request is still in flight is a lie with a timer on it.
   */
  loaded: boolean;
  /** Mints that can back an SPL token envelope right now. */
  envelopeCandidates: TokenCatalogEntry[];
  /** Configured mints this cluster refused, with the reason to show. */
  unusable: (TokenCatalogEntry & { reason: string })[];
  /** Mints worth offering as allow-list quick-adds (anything that resolves). */
  allowListCandidates: TokenCatalogEntry[];
  /** Chain-confirmed decimals for a catalog mint, or null. */
  decimalsFor: (mint: string) => number | null;
  labelFor: (mint: string) => string | null;
}

const Ctx = createContext<TokenCatalogApi | null>(null);

/** The static list, used only where there is no cluster to ask (mock mode). */
function staticCatalog(): TokenCatalogEntry[] {
  const seen = new Set<string>();
  return [...TOKEN_ENVELOPE_MINTS, ...QUICK_MINTS]
    .filter((m) => (seen.has(m.address) ? false : (seen.add(m.address), true)))
    .map((m) => ({
      symbol: m.label,
      mint: m.address,
      decimals: mintDecimals(m.address) ?? null,
      status: "movable" as const,
      native: !TOKEN_ENVELOPE_MINTS.some((t) => t.address === m.address),
    }));
}

/** Why a mint cannot back an envelope, in the owner's language. */
function reasonFor(entry: TokenCatalogEntry): string {
  if (entry.status === "wrong-program") {
    return `${entry.symbol} is issued by ${entry.programId ?? "a program"}, which is neither SPL Token nor Token-2022 — Aegis has no way to move it.`;
  }
  return `${entry.symbol}'s mint isn't on the cluster Praxis transfers on, so an envelope for it could never be used.`;
}

export function TokenCatalogProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<TokenCatalogEntry[]>(() =>
    isApiMode() ? [] : staticCatalog(),
  );
  // Mock mode is answered by the static list on the first render.
  const [loaded, setLoaded] = useState(() => !isApiMode());

  useEffect(() => {
    if (!isApiMode()) return;
    let cancelled = false;
    // Session-gated: a 401 before sign-in resolves to an empty catalog and the
    // pickers simply have nothing to offer — never an error state.
    fetch("/api/praxis/get-token-catalog", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((body) => {
        if (cancelled || !Array.isArray(body)) return;
        setEntries(
          body.filter(
            (e): e is TokenCatalogEntry =>
              Boolean(e) && typeof e.symbol === "string" && typeof e.mint === "string",
          ),
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<TokenCatalogApi>(() => {
    const movable = entries.filter((e) => e.status === "movable");
    return {
      entries,
      loaded,
      envelopeCandidates: movable.filter((e) => !e.native),
      // Wrapped SOL is excluded: native SOL has its own envelope, so its
      // absence is not something the SPL picker should report.
      unusable: entries
        .filter((e) => e.status !== "movable" && !e.native)
        .map((e) => ({ ...e, reason: reasonFor(e) })),
      allowListCandidates: movable,
      decimalsFor: (mint) =>
        entries.find((e) => e.mint === mint)?.decimals ?? mintDecimals(mint) ?? null,
      labelFor: (mint) => entries.find((e) => e.mint === mint)?.symbol ?? mintLabel(mint),
    };
  }, [entries, loaded]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTokenCatalog(): TokenCatalogApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useTokenCatalog must be used inside <TokenCatalogProvider>");
  return api;
}
