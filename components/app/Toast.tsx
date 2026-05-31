"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Toast = { id: number; tone: "success" | "info"; text: string };
type ToastApi = { toast: (text: string, tone?: "success" | "info") => void };

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback((text: string, tone: "success" | "info" = "success") => {
    const id = ++seq.current;
    setToasts((prev) => [...prev, { id, tone, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-[320px] rounded-lg px-3.5 py-2.5 text-[13px] leading-[1.4] shadow-lg [border:0.5px_solid_var(--border)] ${
              t.tone === "success"
                ? "bg-[rgba(91,160,110,0.14)] text-[var(--success,#5BA06E)]"
                : "bg-[var(--surface-2)] text-[var(--text-secondary)]"
            }`}
          >
            {t.text}
          </div>
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
