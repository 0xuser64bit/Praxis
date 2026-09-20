"use client";

/**
 * Stocklana C05: the active-stock switcher state.
 *
 * One policy PDA per wallet holds ONE SPL envelope (single mint) at a time, so
 * "one policy per stock" is an operating model, not a second account: the user
 * picks an active stock, the envelope is (re)configured to its mint, and views
 * follow the selection. This context owns the selection + universe list only —
 * money still flows through the existing `PraxisProvider` (configureToken,
 * activity), untouched.
 *
 * Deliberately outside `PraxisProvider`: no shared-interface change, so the
 * mock provider and SDK need no updates. Address-book entries stay global —
 * labels are mint-agnostic by design (they name people, not assets).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { isApiMode } from "./providerMode";

export interface StockUniverseEntry {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  /**
   * False when Aegis cannot move this mint (Token-2022 vs the program's
   * classic-SPL requirement). Such a stock is research-only: offering it as
   * an envelope would be offering a control whose every use fails.
   */
  transferable?: boolean;
}

interface ActiveStockApi {
  /** Empty unless the server runs with PRAXIS_STOCKS_ENABLED=1. */
  stocks: StockUniverseEntry[];
  stocksEnabled: boolean;
  /** Selected envelope mint, or null for "All". Persisted per browser. */
  activeMint: string | null;
  setActiveMint: (mint: string | null) => void;
  symbolFor: (mint: string) => string | null;
  /** Decimals reported by the server for a universe mint, or null. */
  decimalsFor: (mint: string) => number | null;
}

const Ctx = createContext<ActiveStockApi | null>(null);
const STORAGE_KEY = "praxis.activeMint";

export function ActiveStockProvider({ children }: { children: ReactNode }) {
  const [stocks, setStocks] = useState<StockUniverseEntry[]>([]);
  const [activeMint, setActiveMintState] = useState<string | null>(null);

  useEffect(() => {
    // Mock mode is meant to run with no backend at all; calling a
    // session-gated endpoint there only produced a guaranteed 401 in the
    // console. The switcher is a server-flagged feature, so no universe.
    if (!isApiMode()) return;
    let cancelled = false;
    // Session-gated endpoint: a 401 pre-sign-in resolves to an empty universe
    // and the switcher stays hidden — never an error state.
    fetch("/api/praxis/get-stock-universe", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((body) => {
        if (cancelled || !Array.isArray(body)) return;
        const list = body.filter(
          (s): s is StockUniverseEntry =>
            Boolean(s) && typeof s.symbol === "string" && typeof s.mint === "string",
        );
        // An older backend omits the flag; assume not transferable rather than
        // presenting an envelope control that cannot work.
        setStocks(list);
        try {
          const saved = window.localStorage.getItem(STORAGE_KEY);
          if (saved && list.some((s) => s.mint === saved)) setActiveMintState(saved);
        } catch {
          // Private-mode storage — selection simply doesn't persist.
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setActiveMint = useCallback(
    (mint: string | null) => {
      setActiveMintState(mint);
      try {
        if (mint) window.localStorage.setItem(STORAGE_KEY, mint);
        else window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore persistence failures (see above).
      }
    },
    [],
  );

  const decimalsFor = useCallback(
    (mint: string) => {
      const entry = stocks.find((s) => s.mint === mint);
      return typeof entry?.decimals === "number" ? entry.decimals : null;
    },
    [stocks],
  );

  const symbolFor = useCallback(
    (mint: string) => stocks.find((s) => s.mint === mint)?.symbol ?? null,
    [stocks],
  );

  return (
    <Ctx.Provider
      value={{ stocks, stocksEnabled: stocks.length > 0, activeMint, setActiveMint, symbolFor, decimalsFor }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useActiveStock(): ActiveStockApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useActiveStock must be used inside <ActiveStockProvider>");
  return api;
}

/**
 * The active-stock selector: "All" + one radio per stock. Rendered in Policy →
 * token envelope and above the activity feed; both views follow the selection.
 */
export function StockSwitcher({ label = "Active stock" }: { label?: string }) {
  const { stocks, activeMint, setActiveMint } = useActiveStock();
  if (stocks.length === 0) return null;

  const options: Array<{ mint: string | null; label: string }> = [
    { mint: null, label: "All" },
    ...stocks.map((s) => ({ mint: s.mint as string | null, label: s.symbol })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const selected = (o.mint ?? null) === activeMint;
        const key = o.mint ?? "all";
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            title={o.mint ? `Show ${o.label} only` : "Show all assets"}
            onClick={() => setActiveMint(o.mint)}
            className={`rounded-full px-3 py-1.5 [font-family:var(--font-mono)] text-[11px] [transition:all_0.15s] ${
              selected
                ? "bg-[var(--text-primary)] text-[var(--bg)]"
                : "text-[var(--text-tertiary)] [border:0.5px_solid_var(--border-strong)] hover:text-[var(--text-primary)]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
