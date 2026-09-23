"use client";

import { useSyncExternalStore } from "react";

import { DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL } from "@/server/agent/intentRequest";

/**
 * The user's model key lives in local storage and nowhere else.
 *
 * The snapshot React subscribes to deliberately omits the secret. Callers
 * that need it (the model call, the reveal control) read it back at that
 * moment. Nothing in this file puts the secret on a request, a log line, or
 * the server.
 */

export const OWN_KEY_STORAGE_KEY = "praxis.ownKey.v1";
export const OWN_KEY_DISMISS_KEY = "praxis.ownKey.suggestionDismissed";

export type OwnProviderId = "gemini" | "groq";

export interface OwnKey {
  provider: OwnProviderId;
  secret: string;
}

export interface OwnProviderChoice {
  id: OwnProviderId;
  label: string;
  model: string;
  createUrl: string;
  createLabel: string;
}

export const OWN_PROVIDERS: readonly OwnProviderChoice[] = [
  {
    id: "gemini",
    label: "Gemini",
    model: DEFAULT_GEMINI_MODEL,
    createUrl: "https://aistudio.google.com/apikey",
    createLabel: "Create a Gemini key",
  },
  {
    id: "groq",
    label: "Groq",
    model: DEFAULT_GROQ_MODEL,
    createUrl: "https://console.groq.com/keys",
    createLabel: "Create a Groq key",
  },
];

export function ownProvider(id: OwnProviderId): OwnProviderChoice {
  return OWN_PROVIDERS.find((provider) => provider.id === id) ?? OWN_PROVIDERS[0];
}

export interface OwnKeySnapshot {
  provider: OwnProviderId | null;
  /** Last four characters, for a mask. Null when no key is stored. */
  last4: string | null;
  /** The suggestion stays until the owner closes it. Persisted separately from the key. */
  dismissed: boolean;
  /** In memory only. A failed call from this page; cleared on save, remove, or the next success. */
  problem: string | null;
}

const EMPTY: OwnKeySnapshot = {
  provider: null,
  last4: null,
  dismissed: false,
  problem: null,
};

type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function parseOwnKeyDraft(
  provider: OwnProviderId,
  raw: string,
): { ok: true; key: OwnKey } | { ok: false; reason: string } {
  const secret = raw.trim();
  if (secret.length < 20) return { ok: false, reason: "That is too short to be a key." };
  if (secret.length > 256) return { ok: false, reason: "That is longer than a key should be." };
  if (/\s/.test(secret)) return { ok: false, reason: "A key should be one token, with no spaces." };
  return { ok: true, key: { provider, secret } };
}

export function readOwnKeyFrom(store: Pick<Storage, "getItem">): OwnKey | null {
  const raw = store.getItem(OWN_KEY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { provider?: unknown; secret?: unknown };
    if (parsed.provider !== "gemini" && parsed.provider !== "groq") return null;
    if (typeof parsed.secret !== "string") return null;
    const draft = parseOwnKeyDraft(parsed.provider, parsed.secret);
    return draft.ok ? draft.key : null;
  } catch {
    return null;
  }
}

export function writeOwnKeyTo(store: Pick<Storage, "setItem">, key: OwnKey): void {
  store.setItem(OWN_KEY_STORAGE_KEY, JSON.stringify({ provider: key.provider, secret: key.secret }));
}

export function clearOwnKeyFrom(store: Pick<Storage, "removeItem">): void {
  store.removeItem(OWN_KEY_STORAGE_KEY);
}

export function suggestionDismissedFrom(store: Pick<Storage, "getItem">): boolean {
  return store.getItem(OWN_KEY_DISMISS_KEY) === "1";
}

function browserStore(): KeyStore | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

let problem: string | null = null;
/** Session fallback when this browser refuses local storage, so the X still closes the bar. */
let memoryDismissed = false;
let snapshot: OwnKeySnapshot = EMPTY;
let ready = false;
const listeners = new Set<() => void>();

function compute(): OwnKeySnapshot {
  const store = browserStore();
  const key = store ? readOwnKeyFrom(store) : null;
  return {
    provider: key?.provider ?? null,
    last4: key ? key.secret.slice(-4) : null,
    dismissed: memoryDismissed || (store ? suggestionDismissedFrom(store) : false),
    problem,
  };
}

function publish(): void {
  snapshot = compute();
  ready = true;
  for (const listener of listeners) listener();
}

function ensure(): void {
  if (ready) return;
  snapshot = compute();
  ready = true;
}

export function loadOwnKey(): OwnKey | null {
  const store = browserStore();
  return store ? readOwnKeyFrom(store) : null;
}

export function saveOwnKey(key: OwnKey): void {
  const store = browserStore();
  if (!store) throw new Error("This browser can't store a key.");
  writeOwnKeyTo(store, key);
  problem = null;
  publish();
}

export function removeOwnKey(): void {
  const store = browserStore();
  if (!store) return;
  clearOwnKeyFrom(store);
  problem = null;
  publish();
}

export function dismissOwnKeySuggestion(): void {
  memoryDismissed = true;
  const store = browserStore();
  if (store) store.setItem(OWN_KEY_DISMISS_KEY, "1");
  publish();
}

/** Remember a failed browser call. `null` clears it after a successful one. */
export function reportOwnKeyProblem(next: string | null): void {
  problem = next;
  publish();
}

let storageListening = false;

function listenForStorage(): void {
  if (storageListening || typeof window === "undefined") return;
  storageListening = true;
  window.addEventListener("storage", (event) => {
    if (
      event.key === OWN_KEY_STORAGE_KEY ||
      event.key === OWN_KEY_DISMISS_KEY ||
      event.key === null
    ) {
      publish();
    }
  });
}

export function subscribeOwnKey(listener: () => void): () => void {
  listeners.add(listener);
  listenForStorage();
  return () => {
    listeners.delete(listener);
  };
}

export function getOwnKeySnapshot(): OwnKeySnapshot {
  ensure();
  return snapshot;
}

export function getOwnKeyServerSnapshot(): OwnKeySnapshot {
  return EMPTY;
}

export function useOwnKey(): OwnKeySnapshot {
  return useSyncExternalStore(subscribeOwnKey, getOwnKeySnapshot, getOwnKeyServerSnapshot);
}
