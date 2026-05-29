"use client";

import type {
  ActionProposal,
  ActivityEntry,
  AddressBookEntry,
  AllowListKind,
  PolicyUpdate,
  PolicyView,
  PraxisProvider,
  Thread,
} from "@praxis/shared";

import { createInitialState, type StoreState } from "./mock/seed";

export class RemotePraxisProvider implements PraxisProvider {
  private state: StoreState = createInitialState();
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
  getPolicy = (): PolicyView => this.state.policy;
  getActivity = (): ActivityEntry[] => this.state.activity;
  getAddressBook = (): AddressBookEntry[] => this.state.addressBook;
  isThinking = (threadId: string): boolean => Boolean(this.state.thinking[threadId]);

  newThread = (): string => {
    const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.state = {
      ...this.state,
      threads: [{ id, title: "New session", messages: [], updatedAt: Math.floor(Date.now() / 1000) }, ...this.state.threads],
    };
    this.notify();
    void this.post<{ threadId: string }>("/api/praxis/new-thread", { threadId: id }).then(() => this.refreshAll());
    return id;
  };

  send = async (threadId: string | null, text: string): Promise<{ threadId: string }> => {
    const result = await this.post<{ threadId: string }>("/api/praxis/send", { threadId, text });
    await this.refreshAll();
    return result;
  };

  signProposal = async (proposalId: string): Promise<void> => {
    await this.post("/api/praxis/sign-proposal", { proposalId });
    await this.refreshAll();
  };

  cancelProposal = async (proposalId: string): Promise<void> => {
    await this.post("/api/praxis/cancel-proposal", { proposalId });
    await this.refreshAll();
  };

  updatePolicy = async (patch: PolicyUpdate): Promise<void> => {
    await this.post("/api/praxis/update-policy", { patch: toWire(patch) });
    await this.refreshAll();
  };

  revokeAgent = async (): Promise<void> => {
    await this.post("/api/praxis/revoke-agent", {});
    await this.refreshAll();
  };

  rotateAgent = async (): Promise<void> => {
    await this.post("/api/praxis/rotate-agent", {});
    await this.refreshAll();
  };

  addToAllowList = async (kind: AllowListKind, address: string): Promise<void> => {
    await this.post("/api/praxis/add-to-allow-list", { kind, address });
    await this.refreshAll();
  };

  removeFromAllowList = async (kind: AllowListKind, address: string): Promise<void> => {
    await this.post("/api/praxis/remove-from-allow-list", { kind, address });
    await this.refreshAll();
  };

  private async refreshAll() {
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
    };
    this.notify();
  }

  private async get<T>(url: string): Promise<T> {
    const res = await fetch(url, { cache: "no-store" });
    return fromWire<T>(await parseResponse(res));
  }

  private async post<T = { ok: true }>(url: string, body: unknown): Promise<T> {
    const token = process.env.NEXT_PUBLIC_PRAXIS_DEMO_MUTATION_TOKEN;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-praxis-demo-token": token } : {}),
      },
      body: JSON.stringify(toWire(body)),
    });
    return fromWire<T>(await parseResponse(res));
  }

  private notify() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

async function parseResponse(res: Response): Promise<unknown> {
  const body = await res.json();
  if (!res.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : `Praxis API failed with ${res.status}`);
  }
  return body;
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
  ].includes(key);
}
