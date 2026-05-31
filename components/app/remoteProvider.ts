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

  constructor() {
    void this.refreshAll();
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
    // Flip the thinking flag immediately so the conversation shows a working
    // indicator while the (multi-second) intent parse + simulation run, instead
    // of appearing frozen. Cleared in `finally` once the reply has been fetched.
    this.setThinking(threadId, true);
    try {
      const result = await this.mutate(() => this.post<{ threadId: string }>("/api/praxis/send", { threadId, text }));
      await this.refreshAll();
      return result;
    } finally {
      this.setThinking(threadId, false);
    }
  };

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

  private async refreshAll() {
    try {
      const [threads, policy, activity, addressBook] = await Promise.all([
        this.get<Thread[]>("/api/praxis/get-threads"),
        this.get<PolicyView>("/api/praxis/get-policy"),
        this.get<ActivityEntry[]>("/api/praxis/get-activity"),
        this.get<AddressBookEntry[]>("/api/praxis/get-address-book"),
      ]);

      const proposals: Record<string, ActionProposal> = {};
      for (const thread of threads) {
        for (const message of thread.messages) {
          if (message.role !== "agent") continue;
          for (const block of message.blocks) {
            if (block.type !== "proposal") continue;
            const proposal = await this.get<ActionProposal>(`/api/praxis/get-proposal?id=${encodeURIComponent(block.proposalId)}`);
            proposals[proposal.id] = proposal;
          }
        }
      }

      this.state = {
        ...this.state,
        threads,
        policy,
        activity,
        addressBook,
        proposals,
        connection: { mode: "api", phase: "ready" },
      };
      this.notify();
    } catch (error) {
      this.setConnectionError(error);
    }
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
