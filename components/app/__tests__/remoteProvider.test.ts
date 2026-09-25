import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { RemotePraxisProvider } from "../remoteProvider";

/**
 * The provider polls `/api/praxis/*` on an interval while the tab is visible.
 * That polling used to start in the constructor with nothing to stop it, so a
 * sign-out unmounted the provider while its interval kept hitting the API with
 * a dead session — and signing back in stacked another one.
 */

interface FakeDocument {
  visibilityState: string;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
  listeners: Map<string, Set<() => void>>;
}

function fakeDocument(): FakeDocument {
  const listeners = new Map<string, Set<() => void>>();
  return {
    visibilityState: "visible",
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
  };
}

let doc: FakeDocument;
let liveTimers: Set<ReturnType<typeof setInterval>>;
let requests: string[];
let realDocument: unknown;
let realFetch: typeof globalThis.fetch;
let realSetInterval: typeof globalThis.setInterval;
let realClearInterval: typeof globalThis.clearInterval;

beforeEach(() => {
  doc = fakeDocument();
  requests = [];
  liveTimers = new Set();

  realDocument = (globalThis as { document?: unknown }).document;
  realFetch = globalThis.fetch;
  realSetInterval = globalThis.setInterval;
  realClearInterval = globalThis.clearInterval;

  (globalThis as { document?: unknown }).document = doc;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;

  // Track outstanding intervals so a leak is observable rather than inferred.
  globalThis.setInterval = ((fn: () => void, ms: number) => {
    const id = realSetInterval(fn, ms);
    liveTimers.add(id);
    return id;
  }) as typeof globalThis.setInterval;
  globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
    liveTimers.delete(id);
    realClearInterval(id);
  }) as typeof globalThis.clearInterval;
});

afterEach(() => {
  for (const id of liveTimers) realClearInterval(id);
  (globalThis as { document?: unknown }).document = realDocument;
  globalThis.fetch = realFetch;
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
});

describe("RemotePraxisProvider lifecycle", () => {
  test("constructing one does not start polling", () => {
    new RemotePraxisProvider();
    expect(liveTimers.size).toBe(0);
    expect(doc.listeners.get("visibilitychange")?.size ?? 0).toBe(0);
  });

  test("start begins polling and its disposer stops it", () => {
    const provider = new RemotePraxisProvider();
    const stop = provider.start();
    expect(liveTimers.size).toBe(1);
    expect(doc.listeners.get("visibilitychange")?.size).toBe(1);

    stop();
    expect(liveTimers.size).toBe(0);
    expect(doc.listeners.get("visibilitychange")?.size).toBe(0);
  });

  test("start is idempotent — a re-run cannot stack a second interval", () => {
    const provider = new RemotePraxisProvider();
    provider.start();
    provider.start();
    expect(liveTimers.size).toBe(1);
    provider.stop();
    expect(liveTimers.size).toBe(0);
  });

  test("stop is idempotent", () => {
    const provider = new RemotePraxisProvider();
    provider.start();
    provider.stop();
    provider.stop();
    expect(liveTimers.size).toBe(0);
  });

  test("a stop/start cycle (sign out, sign back in) leaves exactly one poller", () => {
    const provider = new RemotePraxisProvider();
    const stop = provider.start();
    stop();
    provider.start();
    expect(liveTimers.size).toBe(1);
    expect(doc.listeners.get("visibilitychange")?.size).toBe(1);
  });

  test("stopping keeps subscribers, which unsubscribe themselves", () => {
    // React can run the effect's cleanup and setup again (StrictMode) while
    // child components stay mounted and subscribed; dropping their listeners
    // would leave the UI permanently frozen.
    const provider = new RemotePraxisProvider();
    let notified = 0;
    const unsubscribe = provider.subscribe(() => {
      notified += 1;
    });
    provider.start();
    provider.stop();
    provider.newThread(); // any local mutation notifies
    expect(notified).toBeGreaterThan(0);

    const seen = notified;
    unsubscribe();
    provider.newThread();
    expect(notified).toBe(seen);
  });
});

describe("RemotePraxisProvider refresh", () => {
  test("re-pulls the policy and revives the vault token balance as a bigint", async () => {
    // A money key missing from the revive list arrives as a string, and
    // formatting it as base units throws mid-render.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      const body = url.includes("get-policy") ? { vaultBalance: "5", vaultTokenBalance: "1000000000000" } : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;

    const provider = new RemotePraxisProvider();
    await provider.refresh();

    expect(requests.some((url) => url.includes("get-policy"))).toBe(true);
    expect(provider.getPolicy().vaultTokenBalance).toBe(1_000_000_000_000n);
  });
});
