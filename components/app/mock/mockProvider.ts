/**
 * MockPraxisProvider — the in-memory implementation of {@link PraxisProvider}.
 *
 * It is the ENTIRE backend for the demo: it parses intent, runs the Aegis check,
 * holds the policy/vault/activity, and mutates them on owner actions. State lives
 * in memory only (no browser storage) and is rebuilt on reload. Swapping this for
 * a real backend is a one-line change in `ProviderContext`.
 */

import type {
  ActionProposal,
  ActivityEntry,
  AddressBookEntry,
  AllowListKind,
  Message,
  PolicyUpdate,
  PolicyView,
  PraxisProvider,
  Thread,
} from "@praxis/shared";
import {
  DAY_WINDOW_SECONDS,
  MAX_ALLOWED_MINTS,
  MAX_ALLOWED_PROGRAMS,
  MAX_ALLOWED_RECIPIENTS,
} from "@praxis/shared";

import { checkSwapPolicy, parse } from "./intent";
import { checkTransfer } from "./policy";
import { ADDR, createInitialState, type StoreState } from "./seed";

const THINK_MS = 700;
const SIGN_MS = 900;
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

const MAX_BY_KIND: Record<AllowListKind, number> = {
  programs: MAX_ALLOWED_PROGRAMS,
  recipients: MAX_ALLOWED_RECIPIENTS,
  mints: MAX_ALLOWED_MINTS,
};

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function randSig(): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 44; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function failedSig(): string {
  return `Fai1ed${randSig().slice(0, 34)}AegisRejected`;
}

export class MockPraxisProvider implements PraxisProvider {
  private state: StoreState = createInitialState();
  private listeners = new Set<() => void>();
  private seq = 0;

  // --- reactivity ---
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** A monotonically increasing version — the snapshot for `useSyncExternalStore`. */
  getVersion = (): number => this.seq;

  private notify() {
    this.seq++;
    this.listeners.forEach((l) => l());
  }

  private genId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${this.seq++}`;

  private now() {
    return Math.floor(Date.now() / 1000);
  }

  // --- reads ---
  getThreads = (): Thread[] => [...this.state.threads].sort((a, b) => b.updatedAt - a.updatedAt);
  getThread = (id: string): Thread | undefined => this.state.threads.find((t) => t.id === id);
  getProposal = (id: string): ActionProposal | undefined => this.state.proposals[id];
  getPolicy = (): PolicyView => this.state.policy;
  getActivity = (): ActivityEntry[] => [...this.state.activity].sort((a, b) => b.ts - a.ts);
  getAddressBook = (): AddressBookEntry[] => this.state.addressBook;
  isThinking = (threadId: string): boolean => Boolean(this.state.thinking[threadId]);
  getConnectionState = () => ({ mode: "mock" as const, phase: "ready" as const });

  // --- conversation ---
  newThread = (): string => {
    const id = this.genId("t");
    this.state.threads = [
      { id, title: "New session", messages: [], updatedAt: this.now() },
      ...this.state.threads,
    ];
    this.notify();
    return id;
  };

  send = async (threadId: string | null, text: string): Promise<{ threadId: string }> => {
    const tid = threadId ?? this.newThread();
    const thread = this.getThread(tid);
    if (!thread) throw new Error(`unknown thread ${tid}`);

    const userMsg: Message = { id: this.genId("m"), role: "user", ts: this.now(), text };
    thread.messages = [...thread.messages, userMsg];
    thread.updatedAt = this.now();
    this.state.thinking = { ...this.state.thinking, [tid]: true };
    this.notify();

    await delay(THINK_MS);

    const result = parse(text, { state: this.state, now: this.now(), genId: this.genId });

    for (const p of result.proposals) this.state.proposals[p.id] = p;
    if (result.activity.length) this.state.activity = [...result.activity, ...this.state.activity];

    const agentMsg: Message = {
      id: this.genId("m"),
      role: "agent",
      ts: this.now(),
      blocks: result.blocks,
    };
    thread.messages = [...thread.messages, agentMsg];
    if (result.title && (thread.title === "New session" || thread.messages.length <= 2)) {
      thread.title = result.title;
    }
    thread.updatedAt = this.now();
    this.state.thinking = { ...this.state.thinking, [tid]: false };
    this.notify();

    return { threadId: tid };
  };

  signProposal = async (proposalId: string): Promise<void> => {
    const p = this.state.proposals[proposalId];
    if (!p || p.state !== "pending" || !p.check.allowed) return;

    p.state = "signing";
    this.notify();
    await delay(SIGN_MS);

    const sig = randSig();
    const ts = this.now();

    if (p.detail.kind === "transfer") {
      const check = checkTransfer(
        this.state.policy,
        p.detail.amount,
        p.detail.recipientAddress,
        ts,
      );
      if (!check.allowed) {
        p.check = check;
        p.state = "blocked";
        p.simulation = "Rejected by Aegis at signing";
        p.sig = failedSig();
        this.state.activity = [
          {
            id: this.genId("a"),
            kind: "transfer",
            label: p.detail.recipientName,
            asset: p.detail.asset.symbol,
            amount: p.detail.amount,
            decimals: p.detail.asset.decimals,
            result: "rejected",
            reason: check.reason,
            reasonCode: check.reasonCode,
            ts,
            sig: p.sig,
          },
          ...this.state.activity,
        ];
        this.notify();
        return;
      }

      this.applyRollover(ts);
      this.state.policy = {
        ...this.state.policy,
        spentToday: this.state.policy.spentToday + p.detail.amount,
        vaultBalance: this.state.policy.vaultBalance - p.detail.amount,
      };
      p.check = check;
      this.state.activity = [
        {
          id: this.genId("a"),
          kind: "transfer",
          label: p.detail.recipientName,
          asset: p.detail.asset.symbol,
          amount: p.detail.amount,
          decimals: p.detail.asset.decimals,
          result: "allowed",
          ts,
          sig,
        },
        ...this.state.activity,
      ];
    } else {
      const check = checkSwapPolicy(this.state, p.detail.assetOut, ts);
      if (!check.allowed) {
        p.check = check;
        p.state = "blocked";
        p.simulation = "Rejected by policy at signing";
        p.sig = failedSig();
        this.state.activity = [
          {
            id: this.genId("a"),
            kind: "swap",
            label: `${p.detail.assetIn.symbol} → ${p.detail.assetOut.symbol}`,
            asset: p.detail.assetIn.symbol,
            amount: p.detail.amountIn,
            decimals: p.detail.assetIn.decimals,
            result: "rejected",
            reason: check.reason,
            ts,
            sig: p.sig,
          },
          ...this.state.activity,
        ];
        this.notify();
        return;
      }

      p.check = check;
      this.state.activity = [
        {
          id: this.genId("a"),
          kind: "swap",
          label: `${p.detail.assetIn.symbol} → ${p.detail.assetOut.symbol}`,
          asset: p.detail.assetIn.symbol,
          amount: p.detail.amountIn,
          decimals: p.detail.assetIn.decimals,
          result: "allowed",
          ts,
          sig,
        },
        ...this.state.activity,
      ];
    }

    p.sig = sig;
    p.simulation = "Confirmed";
    p.state = "signed";
    this.notify();
  };

  cancelProposal = async (proposalId: string): Promise<void> => {
    const p = this.state.proposals[proposalId];
    if (!p || p.state !== "pending") return;
    p.state = "cancelled";
    this.notify();
  };

  /** Reset spent_today if the rolling 24h window has elapsed (mirrors Aegis). */
  private applyRollover(now: number) {
    if (now >= this.state.policy.dayStartTs + DAY_WINDOW_SECONDS) {
      this.state.policy = { ...this.state.policy, spentToday: 0n, dayStartTs: now };
    }
  }

  // --- policy (owner) ---
  updatePolicy = async (patch: PolicyUpdate): Promise<void> => {
    await delay(250);
    this.state.policy = {
      ...this.state.policy,
      ...(patch.maxPerTx !== undefined ? { maxPerTx: patch.maxPerTx } : {}),
      ...(patch.dailyLimit !== undefined ? { dailyLimit: patch.dailyLimit } : {}),
      ...(patch.expiryTs !== undefined ? { expiryTs: patch.expiryTs } : {}),
      ...(patch.paused !== undefined ? { paused: patch.paused } : {}),
    };
    this.notify();
  };

  revokeAgent = async (): Promise<void> => {
    await delay(SIGN_MS);
    this.state.policy = { ...this.state.policy, paused: true, agentAuthority: SYSTEM_PROGRAM };
    this.notify();
  };

  rotateAgent = async (): Promise<void> => {
    await delay(SIGN_MS);
    this.state.policy = { ...this.state.policy, paused: false, agentAuthority: ADDR.agent };
    this.notify();
  };

  addToAllowList = async (kind: AllowListKind, address: string): Promise<void> => {
    const key = (
      { programs: "allowedPrograms", recipients: "allowedRecipients", mints: "allowedMints" } as const
    )[kind];
    const list = this.state.policy[key];
    if (list.includes(address) || list.length >= MAX_BY_KIND[kind]) return;
    this.state.policy = { ...this.state.policy, [key]: [...list, address] };
    this.notify();
  };

  removeFromAllowList = async (kind: AllowListKind, address: string): Promise<void> => {
    const key = (
      { programs: "allowedPrograms", recipients: "allowedRecipients", mints: "allowedMints" } as const
    )[kind];
    this.state.policy = {
      ...this.state.policy,
      [key]: this.state.policy[key].filter((a) => a !== address),
    };
    this.notify();
  };
}
