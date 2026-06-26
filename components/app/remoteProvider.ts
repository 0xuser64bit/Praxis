"use client";

import type {
  ActionProposal,
  ActivityEntry,
  AddressBookEntry,
  AllowListKind,
  PolicyUpdate,
  PolicyView,
  ProviderConnectionState,
  PraxisProvider,
  Thread,
  TokenEnvelopeConfig,
} from "@praxis/shared";

import { getOwnerWalletSigner } from "./lib/walletSigner";

/** Client mirror of the server's owner-action request shape (validated server-side). */
type OwnerActionRequest =
  | { kind: "bootstrapPolicy"; fundLamports: bigint }
  | { kind: "fundVault"; amount: bigint }
  | { kind: "withdrawVault"; amount: bigint }
  | { kind: "closePolicy" }
  | { kind: "updatePolicy"; patch: PolicyUpdate }
  | { kind: "allowList"; listKind: AllowListKind; address: string; mode: "add" | "remove" }
  | { kind: "revoke" }
  | { kind: "rotate" };

interface OwnerActionDraft {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

interface RemoteStoreState {
  threads: Thread[];
  proposals: Record<string, ActionProposal>;
  policy?: PolicyView;
  activity: ActivityEntry[];
  addressBook: AddressBookEntry[];
  thinking: Record<string, boolean>;
  connection: ProviderConnectionState;
}

function createEmptyState(): RemoteStoreState {
  return {
    threads: [],
    proposals: {},
    activity: [],
    addressBook: [],
    thinking: {},
    connection: { mode: "api", phase: "loading" },
  };
}

export class RemotePraxisProvider implements PraxisProvider {
  private state: RemoteStoreState = createEmptyState();
  private listeners = new Set<() => void>();
  private version = 0;
  // Monotonic token so a slow, stale `refreshAll` can't overwrite the result of
  // a newer one that started after it (out-of-order completion). Only the most
  // recently started refresh is allowed to commit its snapshot.
  private refreshToken = 0;
  // Threads with an in-flight `send`. While a send is pending we keep the local
  // (optimistic) copy of that thread on every refresh, so a background refresh
  // racing the send can't wipe the message the user just typed.
  private pendingSends = new Set<string>();

  constructor() {
    void this.refreshAll();
    this.startBackgroundRefresh();
  }

  /**
   * Keep the app live without a websocket: while the tab is visible, re-pull
   * policy + activity on an interval so a confirmation that lands after the
   * optimistic refresh (or any out-of-band change) actually surfaces. Refresh is
   * five flat parallel reads, so this is cheap and well under the read limit.
   * Background ticks fail silently — a transient blip must not tear the app down
   * to an error screen mid-flow.
   */
  private startBackgroundRefresh() {
    if (typeof document === "undefined") return;
    const REFRESH_MS = 12_000;
    setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (this.pendingSends.size > 0) return; // never race an in-flight send
      void this.refreshAll({ background: true });
    }, REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.pendingSends.size === 0) {
        void this.refreshAll({ background: true });
      }
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  getThreads = (): Thread[] => this.state.threads;
  getThread = (id: string): Thread | undefined => this.state.threads.find((thread) => thread.id === id);
  getProposal = (id: string): ActionProposal | undefined => this.state.proposals[id];
  getPolicy = (): PolicyView => {
    if (!this.state.policy) throw new Error("Praxis API policy has not loaded yet.");
    return this.state.policy;
  };
  getActivity = (): ActivityEntry[] => this.state.activity;
  getAddressBook = (): AddressBookEntry[] => this.state.addressBook;
  isThinking = (threadId: string): boolean => Boolean(this.state.thinking[threadId]);
  getConnectionState = (): ProviderConnectionState => this.state.connection;

  newThread = (): string => {
    const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.state = {
      ...this.state,
      threads: [{ id, title: "New session", messages: [], updatedAt: Math.floor(Date.now() / 1000) }, ...this.state.threads],
    };
    this.notify();
    void this.mutate(() => this.post<{ threadId: string }>("/api/praxis/new-thread", { threadId: id }))
      .then(() => this.refreshAll())
      .catch(() => undefined);
    return id;
  };

  send = async (threadId: string | null, text: string): Promise<{ threadId: string }> => {
    // Render the user's line immediately as an optimistic bubble. Without this,
    // the composer clears the input the moment you hit send but nothing appears
    // until the multi-second server round-trip (intent parse + simulation)
    // returns — so the text looks like it vanished. The optimistic message is
    // replaced by the server's authoritative copy once the reply is fetched.
    this.appendOptimisticUserMessage(threadId, text);
    if (threadId) this.pendingSends.add(threadId);
    // Flip the thinking flag immediately so the conversation shows a working
    // indicator while the request runs. Cleared in `finally`.
    this.setThinking(threadId, true);
    try {
      const result = await this.mutate(() => this.post<{ threadId: string }>("/api/praxis/send", { threadId, text }));
      // Clear the pending guard BEFORE the authoritative refresh so it adopts
      // the server's copy of this thread (the real persisted messages).
      if (threadId) this.pendingSends.delete(threadId);
      await this.refreshAll();
      return result;
    } catch (error) {
      if (threadId) this.pendingSends.delete(threadId);
      throw error;
    } finally {
      this.setThinking(threadId, false);
    }
  };

  private appendOptimisticUserMessage(threadId: string | null, text: string) {
    if (!threadId) return;
    const index = this.state.threads.findIndex((thread) => thread.id === threadId);
    if (index < 0) return;
    const ts = Math.floor(Date.now() / 1000);
    const message: Thread["messages"][number] = {
      id: `m-opt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      role: "user",
      ts,
      text,
    };
    const existing = this.state.threads[index];
    const threads = [...this.state.threads];
    threads[index] = { ...existing, messages: [...existing.messages, message], updatedAt: ts };
    this.state = { ...this.state, threads };
    this.notify();
  }

  private setThinking(threadId: string | null, value: boolean) {
    if (!threadId) return;
    this.state = {
      ...this.state,
      thinking: { ...this.state.thinking, [threadId]: value },
    };
    this.notify();
  }

  signProposal = async (proposalId: string): Promise<void> => {
    await this.mutate(() => this.post("/api/praxis/sign-proposal", { proposalId }));
    await this.refreshAll();
  };

  cancelProposal = async (proposalId: string): Promise<void> => {
    await this.mutate(() => this.post("/api/praxis/cancel-proposal", { proposalId }));
    await this.refreshAll();
  };

  bootstrapPolicy = async (fundLamports: bigint = 0n): Promise<void> => {
    await this.ownerAction(
      { kind: "bootstrapPolicy", fundLamports },
      () => this.post("/api/praxis/bootstrap-policy", { fundLamports }),
    );
    await this.refreshAll();
  };

  fundVault = async (amount: bigint): Promise<void> => {
    await this.ownerAction(
      { kind: "fundVault", amount },
      () => this.post("/api/praxis/fund-vault", { amount }),
    );
    await this.refreshAll();
  };

  withdrawVault = async (amount: bigint): Promise<void> => {
    await this.ownerAction(
      { kind: "withdrawVault", amount },
      () => this.post("/api/praxis/withdraw-vault", { amount }),
    );
    await this.refreshAll();
  };

  deleteAgent = async (): Promise<void> => {
    await this.ownerAction(
      { kind: "closePolicy" },
      () => this.post("/api/praxis/delete-agent", {}),
    );
    await this.refreshAll();
  };

  updatePolicy = async (patch: PolicyUpdate): Promise<void> => {
    await this.ownerAction(
      { kind: "updatePolicy", patch },
      () => this.post("/api/praxis/update-policy", { patch: toWire(patch) }),
    );
    await this.refreshAll();
  };

  configureToken = async (config: TokenEnvelopeConfig): Promise<void> => {
    await this.mutate(() => this.post("/api/praxis/configure-token", { config: toWire(config) }));
    await this.refreshAll();
  };

  prepareTokenAccounts = async (recipientAddresses: string[] = []): Promise<void> => {
    await this.mutate(() => this.post("/api/praxis/prepare-token-accounts", { recipientAddresses }));
    await this.refreshAll();
  };

  revokeAgent = async (): Promise<void> => {
    await this.ownerAction({ kind: "revoke" }, () => this.post("/api/praxis/revoke-agent", {}));
    await this.refreshAll();
  };

  rotateAgent = async (): Promise<void> => {
    await this.ownerAction({ kind: "rotate" }, () => this.post("/api/praxis/rotate-agent", {}));
    await this.refreshAll();
  };

  addToAllowList = async (kind: AllowListKind, address: string): Promise<void> => {
    await this.ownerAction(
      { kind: "allowList", listKind: kind, address, mode: "add" },
      () => this.post("/api/praxis/add-to-allow-list", { kind, address }),
    );
    await this.refreshAll();
  };

  removeFromAllowList = async (kind: AllowListKind, address: string): Promise<void> => {
    await this.ownerAction(
      { kind: "allowList", listKind: kind, address, mode: "remove" },
      () => this.post("/api/praxis/remove-from-allow-list", { kind, address }),
    );
    await this.refreshAll();
  };

  /**
   * Run an owner action. When a signing wallet is present, build the unsigned
   * transaction server-side, sign it in the wallet, and submit it — the backend
   * never holds the owner key. Otherwise fall back to the backend-keypair route
   * (local/devnet), which 503s if no backend owner key is configured.
   */
  private async ownerAction(action: OwnerActionRequest, legacy: () => Promise<unknown>): Promise<void> {
    const signer = getOwnerWalletSigner();
    if (!signer) {
      await this.mutate(legacy);
      return;
    }
    const draft = await this.post<OwnerActionDraft>("/api/praxis/owner/build", { action });
    const transaction = await signer.signTransaction(draft.transaction);
    await this.mutate(() =>
      this.post("/api/praxis/owner/submit", {
        transaction,
        blockhash: draft.blockhash,
        lastValidBlockHeight: draft.lastValidBlockHeight,
      }),
    );
  }

  private async refreshAll(opts: { background?: boolean } = {}) {
    const token = ++this.refreshToken;
    try {
      // Five parallel reads, flat — regardless of conversation length. Proposals
      // come back as a single batch (`get-proposals`) rather than one request per
      // proposal block, which previously made refresh O(proposals) sequential
      // round-trips on every mutation and could trip the read rate limit.
      const [threads, policy, activity, addressBook, proposalList] = await Promise.all([
        this.get<Thread[]>("/api/praxis/get-threads"),
        this.get<PolicyView>("/api/praxis/get-policy"),
        this.get<ActivityEntry[]>("/api/praxis/get-activity"),
        this.get<AddressBookEntry[]>("/api/praxis/get-address-book"),
        this.get<ActionProposal[]>("/api/praxis/get-proposals"),
      ]);
      // A newer refresh started while we were awaiting — its snapshot is fresher,
      // so discard ours rather than clobber it with stale data.
      if (token !== this.refreshToken) return;

      const proposals: Record<string, ActionProposal> = {};
      for (const proposal of proposalList) proposals[proposal.id] = proposal;

      this.state = {
        ...this.state,
        threads: this.mergePendingThreads(threads),
        policy,
        activity,
        addressBook,
        proposals,
        connection: { mode: "api", phase: "ready" },
      };
      this.notify();
    } catch (error) {
      // Foreground loads (initial mount, post-mutation) surface the error;
      // background polls keep the last good state instead of flashing an error.
      if (token === this.refreshToken && !opts.background) this.setConnectionError(error);
    }
  }

  /**
   * Overlay the local copy of any thread with an in-flight send on top of the
   * server snapshot, so a refresh that races the send can't drop the optimistic
   * message. Threads without a pending send always take the server's version.
   */
  private mergePendingThreads(serverThreads: Thread[]): Thread[] {
    if (this.pendingSends.size === 0) return serverThreads;
    const result = serverThreads.map((thread) => {
      if (!this.pendingSends.has(thread.id)) return thread;
      return this.state.threads.find((local) => local.id === thread.id) ?? thread;
    });
    // Keep pending threads that the server hasn't materialized yet (brand-new
    // thread + immediate send) so they don't disappear mid-send.
    for (const id of this.pendingSends) {
      if (serverThreads.some((thread) => thread.id === id)) continue;
      const local = this.state.threads.find((thread) => thread.id === id);
      if (local) result.unshift(local);
    }
    return result;
  }

  private async get<T>(url: string): Promise<T> {
    const res = await fetch(url, { cache: "no-store" });
    return fromWire<T>(await parseResponse(res));
  }

  private async post<T = { ok: true }>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toWire(body)),
    });
    return fromWire<T>(await parseResponse(res));
  }

  private async mutate<T>(fn: () => Promise<T>): Promise<T> {
    const result = await fn();
    // Only promote the connection to "ready" once a policy is actually loaded.
    // A successful bootstrap submit resolves BEFORE the follow-up refreshAll()
    // has fetched the freshly-created policy; flipping to "ready" here would
    // render ReadyAppShell (which calls getPolicy()) and throw "policy has not
    // loaded yet". refreshAll() is the authority on load state in that window.
    if (this.state.policy) {
      this.state = { ...this.state, connection: { mode: "api", phase: "ready" } };
      this.notify();
    }
    return result;
  }

  private setConnectionError(error: unknown) {
    this.state = {
      ...this.state,
      connection: {
        mode: "api",
        phase: "error",
        message: error instanceof Error ? error.message : "Praxis API request failed.",
      },
    };
    this.notify();
  }

  private notify() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

async function parseResponse(res: Response): Promise<unknown> {
  const body = await readResponseBody(res);
  if (!res.ok) {
    throw new Error(errorMessage(body, res.status));
  }
  return body;
}

async function readResponseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return `Praxis API failed with ${status}`;
}

function toWire(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toWire);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toWire(item)]));
  }
  return value;
}

function fromWire<T>(value: unknown): T {
  return revive(value) as T;
}

function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive);
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (isMoneyKey(key) && typeof item === "string" && /^-?\d+$/.test(item)) out[key] = BigInt(item);
    else out[key] = revive(item);
  }
  return out;
}

function isMoneyKey(key: string): boolean {
  return [
    "amount",
    "amountIn",
    "estAmountOut",
    "networkFee",
    "maxPerTx",
    "dailyLimit",
    "spentToday",
    "remaining",
    "vaultBalance",
    "tokenMaxPerTx",
    "tokenDailyLimit",
    "tokenSpentToday",
  ].includes(key);
}
