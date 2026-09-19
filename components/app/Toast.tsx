"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Toast = { id: number; tone: "success" | "info"; text: string };
type ToastApi = { toast: (text: string, tone?: "success" | "info") => void };

const Ctx = createContext<ToastApi | null>(null);

const MAX_LENGTH = 90;
const VISIBLE_MS = 2500;
const MAX_STACK = 3;

/**
 * Keep toasts to one short line: first sentence only, cut before an em-dash
 * aside ("Manage it in Policy → …" lives in the thread itself), hard cap.
 */
function shorten(text: string): string {
  const first = text.split(/(?<=[.!?])\s/)[0].split(" — ")[0].trim();
  return first.length > MAX_LENGTH ? `${first.slice(0, MAX_LENGTH - 1).trimEnd()}…` : first;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback((text: string, tone: "success" | "info" = "success") => {
    const id = ++seq.current;
    setToasts((prev) => [...prev.slice(-(MAX_STACK - 1)), { id, tone, text: shorten(text) }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), VISIBLE_MS);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setToasts([]);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed top-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-1.5"
      >
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            title="Dismiss"
            className="pointer-events-auto flex max-w-[min(480px,90vw)] items-center gap-2 truncate rounded-full bg-[var(--bg-card)] py-1.5 pr-3 pl-2.5 text-[12.5px] whitespace-nowrap text-[var(--text-secondary)] shadow-lg [animation:toastIn_0.2s_ease-out] [border:0.5px_solid_var(--border-strong)]"
          >
            <span
              aria-hidden
              className="h-[6px] w-[6px] shrink-0 rounded-full"
              style={{ background: t.tone === "success" ? "var(--success)" : "var(--accent)" }}
            />
            <span className="truncate">{t.text}</span>
          </button>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}
