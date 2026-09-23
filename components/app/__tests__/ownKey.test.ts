import { describe, expect, test } from "bun:test";

import {
  buildGeminiCall,
  buildOpenAICompatCall,
  DEFAULT_GROQ_MODEL,
  GROQ_BASE_URL,
} from "@/server/agent/intentRequest";

import { explainOwnKeyFailure, intentSendFields, readIntentWithOwnKey } from "../lib/browserIntent";
import {
  OWN_KEY_DISMISS_KEY,
  OWN_KEY_STORAGE_KEY,
  clearOwnKeyFrom,
  parseOwnKeyDraft,
  readOwnKeyFrom,
  removeOwnKey,
  saveOwnKey,
  suggestionDismissedFrom,
  writeOwnKeyTo,
} from "../lib/ownKey";

const SECRET = "AIzaSyTHIS-IS-THE-SECRET-KEY";

function memory(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("a model key stays in browser storage", () => {
  test("round-trips, and dismissing the suggestion does not remove it", () => {
    const store = memory();
    const draft = parseOwnKeyDraft("gemini", `  ${SECRET}  `);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    writeOwnKeyTo(store, draft.key);

    expect(readOwnKeyFrom(store)).toEqual({ provider: "gemini", secret: SECRET });
    expect(suggestionDismissedFrom(store)).toBe(false);

    store.setItem(OWN_KEY_DISMISS_KEY, "1");
    expect(suggestionDismissedFrom(store)).toBe(true);
    expect(readOwnKeyFrom(store)?.secret).toBe(SECRET);

    clearOwnKeyFrom(store);
    expect(readOwnKeyFrom(store)).toBeNull();
    expect(suggestionDismissedFrom(store)).toBe(true);
  });

  test("rejects a short value, spaces, and a stored shape that is not a key", () => {
    expect(parseOwnKeyDraft("groq", "too short").ok).toBe(false);
    expect(parseOwnKeyDraft("groq", `${SECRET} extra`).ok).toBe(false);

    const store = memory();
    store.setItem(OWN_KEY_STORAGE_KEY, "{");
    expect(readOwnKeyFrom(store)).toBeNull();
    store.setItem(OWN_KEY_STORAGE_KEY, JSON.stringify({ provider: "openai", secret: SECRET }));
    expect(readOwnKeyFrom(store)).toBeNull();
  });
});

describe("the key is not part of what leaves the browser", () => {
  test("the Gemini and Groq calls put the key in a header and not the URL or body", () => {
    const gemini = buildGeminiCall("buy $40 openai", SECRET);
    expect(gemini.url).toContain("generativelanguage.googleapis.com");
    expect(gemini.url).not.toContain(SECRET);
    expect(String(gemini.init.body)).not.toContain(SECRET);
    expect((gemini.init.headers as Record<string, string>)["x-goog-api-key"]).toBe(SECRET);

    const groq = buildOpenAICompatCall("buy $40 openai", {
      baseUrl: GROQ_BASE_URL,
      apiKey: SECRET,
      model: DEFAULT_GROQ_MODEL,
    });
    expect(groq.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(groq.url).not.toContain(SECRET);
    expect(String(groq.init.body)).not.toContain(SECRET);
    expect((groq.init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
  });

  test("the send body carries the reading or a failure flag, never the secret", () => {
    const failed = intentSendFields({ ok: false, reason: `status 401 ${SECRET}` });
    expect(failed).toEqual({ ownIntentFailed: true });
    expect(JSON.stringify(failed)).not.toContain(SECRET);

    const ok = intentSendFields({
      ok: true,
      raw: { outcome: "clarify", question: "Which asset?" },
    });
    const body = JSON.stringify({ threadId: "t1", text: "buy openai", ...ok });
    expect(body).toContain("Which asset?");
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain("apiKey");
  });

  test("the browser call retries a 503 and does not retry a rejected key", async () => {
    const previousStorage = globalThis.localStorage;
    const previousFetch = globalThis.fetch;
    const store = memory();
    Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true });
    saveOwnKey({ provider: "gemini", secret: SECRET });

    try {
      let calls = 0;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls += 1;
        expect(String(input)).not.toContain(SECRET);
        expect(String(init?.body)).not.toContain(SECRET);
        const headers = init?.headers as Record<string, string>;
        expect(headers["x-goog-api-key"]).toBe(SECRET);
        return new Response("no", { status: 401 });
      }) as unknown as typeof fetch;
      const rejected = await readIntentWithOwnKey("buy $40 openai");
      expect(rejected).toEqual({ ok: false, reason: "The model rejected this key." });
      expect(calls).toBe(1);

      calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        if (calls === 1) return new Response("busy", { status: 503 });
        return new Response(
          JSON.stringify({
            candidates: [{
              content: {
                parts: [{
                  functionCall: {
                    name: "parse_praxis_intent",
                    args: { outcome: "clarify", question: "Which asset?" },
                  },
                }],
              },
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;
      const read = await readIntentWithOwnKey("buy $40 openai");
      expect(read).toEqual({ ok: true, raw: { outcome: "clarify", question: "Which asset?" } });
      expect(calls).toBe(2);
    } finally {
      removeOwnKey();
      globalThis.fetch = previousFetch;
      Object.defineProperty(globalThis, "localStorage", { value: previousStorage, configurable: true });
    }
  });

  test("a failure the owner can see does not repeat the key", () => {
    expect(explainOwnKeyFailure(new Error(`status 401 leaked ${SECRET}`), SECRET)).toBe(
      "The model rejected this key.",
    );
    expect(explainOwnKeyFailure(new Error("status 429"), SECRET)).toBe(
      "This key is rate-limited right now.",
    );
    expect(explainOwnKeyFailure(new Error("Failed to fetch"), SECRET)).toBe(
      "The browser couldn't reach the model. The key stayed on this page.",
    );
  });
});
