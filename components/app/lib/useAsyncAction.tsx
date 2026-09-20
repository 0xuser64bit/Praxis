"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Pending/error state for owner actions.
 *
 * Every policy mutation here is a wallet signature followed by an on-chain
 * confirmation — five to fifteen seconds of nothing. These were fire-and-
 * forget: the form closed the instant you clicked, and the only feedback was
 * an error banner at the top of a scrolled page if it failed. You could not
 * tell a pending action from a silently dropped one, and nothing stopped you
 * from firing the same transaction twice.
 *
 * One action runs at a time, which matches reality — the wallet prompt is
 * modal. `pendingKey` identifies which control is waiting so it alone shows a
 * spinner, while `busy` disables the rest.
 */

/** The most recently finished action. `seq` advances on every completion. */
export interface SettledAction {
  key: string;
  ok: boolean;
  seq: number;
}

export interface AsyncActions {
  /** Key of the running action, or null when idle. */
  pendingKey: string | null;
  /** The last action to finish, so a card can react to its own completing. */
  settled: SettledAction | null;
  /** True while any action is in flight. */
  busy: boolean;
  /** Human label of the running action, for the status banner. */
  pendingLabel: string | null;
  error: string | null;
  clearError: () => void;
  /**
   * Run an owner action. Ignored while another is in flight, so a double
   * click cannot submit two transactions. Reports success via `onSuccess`.
   */
  run: (key: string, action: () => Promise<void>, opts: RunOptions) => void;
}

export interface RunOptions {
  /** Shown in the status banner while running, e.g. "Adding funds". */
  label: string;
  /** Error message when the failure carries none. */
  fallback: string;
  /** Confirmation to surface on success. */
  success?: string;
}

export function useAsyncActions(onSuccess?: (message: string) => void): AsyncActions {
  const [pending, setPending] = useState<{ key: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState<SettledAction | null>(null);
  const seq = useRef(0);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    (key: string, action: () => Promise<void>, opts: RunOptions) => {
      // A second click while the wallet prompt is open must not queue another
      // signature request.
      if (pending) return;
      setError(null);
      setPending({ key, label: opts.label });
      void action()
        .then(() => {
          if (opts.success) onSuccess?.(opts.success);
          return true;
        })
        .catch((err: unknown) => {
          setError(messageFromError(err, opts.fallback));
          return false;
        })
        .then((ok) => {
          // An explicit completion signal, rather than leaving cards to infer
          // one from a pending → idle render transition: an action that
          // settles in a microtask (a mock provider, a cached read) can have
          // both state updates batched into a single render, and the
          // transition is then never observed.
          seq.current += 1;
          setSettled({ key, ok, seq: seq.current });
          setPending(null);
        });
    },
    [pending, onSuccess],
  );

  return useMemo(
    () => ({
      pendingKey: pending?.key ?? null,
      pendingLabel: pending?.label ?? null,
      busy: pending !== null,
      settled,
      error,
      clearError,
      run,
    }),
    [pending, settled, error, clearError, run],
  );
}

/**
 * Wallet rejections are the common case and arrive with noisy provider
 * wording; say something a person can act on instead.
 */
export function messageFromError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (!message) return fallback;
  if (/user rejected|user denied|rejected the request|declined/i.test(message)) {
    return "You declined the signature in your wallet — nothing was submitted.";
  }
  return message;
}

// --- context, so nested cards can disable themselves without prop drilling ---

const Ctx = createContext<AsyncActions | null>(null);

export function AsyncActionProvider({
  value,
  children,
}: {
  value: AsyncActions;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Pending/busy/error state for the surrounding action scope. */
export function useActionState(): Pick<AsyncActions, "busy" | "pendingKey" | "error" | "settled"> {
  const ctx = useContext(Ctx);
  return {
    busy: ctx?.busy ?? false,
    pendingKey: ctx?.pendingKey ?? null,
    error: ctx?.error ?? null,
    settled: ctx?.settled ?? null,
  };
}

/**
 * Run `onSettled` when the action identified by `keys` finishes, with whether
 * it succeeded. Lets a form stay open and disabled for the whole wallet
 * round-trip and close only once the action actually lands.
 */
export function useActionCompletion(keys: string[], onSettled: (ok: boolean) => void) {
  const { settled } = useActionState();
  const handled = useRef(0);
  const callback = useRef(onSettled);
  const watched = keys.join("|");

  useEffect(() => {
    callback.current = onSettled;
  });

  useEffect(() => {
    if (!settled || settled.seq === handled.current) return;
    handled.current = settled.seq;
    if (watched.split("|").includes(settled.key)) callback.current(settled.ok);
  }, [settled, watched]);
}

/** Stable keys shared by the dashboard (which sets them) and cards (which compare). */
export const actionKeys = {
  fund: "vault:fund",
  withdraw: "vault:withdraw",
  updatePolicy: "policy:update",
  maxPerTx: "policy:maxPerTx",
  dailyLimit: "policy:dailyLimit",
  expiry: "policy:expiry",
  pause: "policy:pause",
  rotate: "agent:rotate",
  revoke: "agent:revoke",
  deleteAgent: "agent:delete",
  configureToken: "token:configure",
  prepareAccounts: "token:prepare",
  allowList: (kind: string, address: string, mode: string) => `allowlist:${kind}:${mode}:${address}`,
  addContact: "contacts:add",
  removeContact: (key: string) => `contacts:remove:${key}`,
} as const;
