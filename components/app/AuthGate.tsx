"use client";

import {
  IconAlertTriangle,
  IconShieldCheck,
  IconWallet,
} from "@tabler/icons-react";
import bs58 from "bs58";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface AuthSession {
  authenticated: boolean;
  walletAddress?: string;
  expiresAt?: number;
}

interface AuthContextValue {
  walletAddress: string;
  expiresAt?: number;
  signOut: () => Promise<void>;
}

interface SolanaWallet {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string };
  connect(input?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  signMessage(message: Uint8Array, display?: "utf8"): Promise<{ signature: Uint8Array } | Uint8Array>;
}

declare global {
  interface Window {
    solana?: SolanaWallet;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthSession(): AuthContextValue | null {
  return useContext(AuthContext);
}

export function ApiAuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession>({ authenticated: false });
  const [phase, setPhase] = useState<"checking" | "signed-out" | "signing" | "ready">("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getJson<AuthSession>("/api/praxis/auth/session")
      .then((next) => {
        if (cancelled) return;
        setSession(next);
        setPhase(next.authenticated && next.walletAddress ? "ready" : "signed-out");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load auth session.");
        setPhase("signed-out");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async () => {
    setPhase("signing");
    setError(null);
    try {
      const wallet = window.solana;
      if (!wallet?.connect || !wallet.signMessage) {
        throw new Error("No Solana wallet with message signing was found in this browser.");
      }

      const connected = await wallet.connect({ onlyIfTrusted: false });
      const walletAddress = connected.publicKey.toBase58();
      const challenge = await postJson<{
        address: string;
        nonce: string;
        message: string;
      }>("/api/praxis/auth/challenge", { address: walletAddress });

      const signed = await wallet.signMessage(new TextEncoder().encode(challenge.message), "utf8");
      const signatureBytes = signed instanceof Uint8Array ? signed : signed.signature;
      const verified = await postJson<AuthSession>("/api/praxis/auth/verify", {
        address: challenge.address,
        nonce: challenge.nonce,
        signature: bs58.encode(signatureBytes),
      });

      setSession(verified);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet sign-in failed.");
      setPhase("signed-out");
    }
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/praxis/auth/session", { method: "DELETE" });
    setSession({ authenticated: false });
    setPhase("signed-out");
  }, []);

  const value = useMemo<AuthContextValue | null>(() => {
    if (!session.authenticated || !session.walletAddress) return null;
    return {
      walletAddress: session.walletAddress,
      expiresAt: session.expiresAt,
      signOut,
    };
  }, [session, signOut]);

  if (phase === "checking") {
    return (
      <AuthScreen
        title="Checking wallet session"
        message="Loading your authenticated Praxis workspace."
        busy
      />
    );
  }

  if (phase === "ready" && value) {
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  }

  return (
    <AuthScreen
      title="Sign in with Solana"
      message="Praxis uses your wallet address as the owner boundary for policy, proposals, and activity."
      error={error}
      onSignIn={signIn}
      signing={phase === "signing"}
    />
  );
}

function AuthScreen({
  title,
  message,
  busy = false,
  signing = false,
  error,
  onSignIn,
}: {
  title: string;
  message: string;
  busy?: boolean;
  signing?: boolean;
  error?: string | null;
  onSignIn?: () => void;
}) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--bg)] px-6">
      <div className="w-full max-w-[440px] rounded-lg bg-[var(--bg-card)] p-6 [border:0.5px_solid_var(--border-strong)]">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-dim)] text-[var(--accent)]">
            {busy || signing ? (
              <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
            ) : (
              <IconShieldCheck size={19} />
            )}
          </span>
          <div className="min-w-0">
            <h1 className="[font-family:var(--font-serif)] text-[25px] leading-none text-[var(--text-primary)]">
              {title}
            </h1>
            <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">Wallet-owned session</p>
          </div>
        </div>

        <p className="text-[13.5px] leading-[1.6] text-[var(--text-secondary)]">{message}</p>

        {error && (
          <div className="mt-4 flex gap-2 rounded-md bg-[rgba(199,91,91,0.12)] p-3 text-[12.5px] leading-[1.5] text-[var(--danger)]">
            <IconAlertTriangle size={15} className="mt-[2px] shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {onSignIn && (
          <button
            type="button"
            disabled={signing}
            onClick={onSignIn}
            className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--bg)] [transition:opacity_0.15s] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <IconWallet size={16} />
            {signing ? "Waiting for signature" : "Connect wallet"}
          </button>
        )}
      </div>
    </div>
  );
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  return parseResponse<T>(res);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(res);
}

async function parseResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body?.error === "string" ? body.error : `Praxis API failed with ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}
