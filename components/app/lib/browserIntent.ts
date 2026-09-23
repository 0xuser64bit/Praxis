"use client";

import {
  buildGeminiCall,
  buildOpenAICompatCall,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GROQ_MODEL,
  GROQ_BASE_URL,
  LLM_ATTEMPTS,
  readGeminiToolArgs,
  readOpenAIToolArguments,
  RETRYABLE_STATUS,
} from "@/server/agent/intentRequest";

import { loadOwnKey, ownProvider, reportOwnKeyProblem, type OwnKey } from "./ownKey";

/**
 * Read a message with the key stored in this browser.
 *
 * Returns null when there is no key — the caller then uses the shared
 * parser. On failure the key is not attached to anything that leaves the
 * page; the caller tells the server only that the attempt failed.
 */

export type BrowserReading =
  | { ok: true; raw: unknown }
  | { ok: false; reason: string };

const ATTEMPT_TIMEOUT_MS = 15_000;
const STATUS_ERROR = /status (\d+)/;
const NETWORK_ERROR = /failed to fetch|networkerror|load failed|network request failed|cors|aborted|timed out/i;

export async function readIntentWithOwnKey(text: string): Promise<BrowserReading | null> {
  const key = loadOwnKey();
  if (!key) return null;
  try {
    const raw = await callModel(text, key);
    reportOwnKeyProblem(null);
    return { ok: true, raw };
  } catch (error) {
    const reason = explainOwnKeyFailure(error, key.secret);
    reportOwnKeyProblem(reason);
    return { ok: false, reason };
  }
}

/** Fields safe to POST. The secret is not one of them. */
export function intentSendFields(
  reading: BrowserReading | null,
): { ownIntent?: unknown; ownIntentFailed?: true } {
  if (!reading) return {};
  if (reading.ok) return { ownIntent: reading.raw };
  return { ownIntentFailed: true };
}

export function explainOwnKeyFailure(error: unknown, secret: string): string {
  const raw = error instanceof Error ? error.message : "The call failed";
  const scrubbed = raw.split(secret).join("").replace(/\s+/g, " ").trim();
  const status = scrubbed.match(STATUS_ERROR);
  if (status) {
    const code = Number(status[1]);
    if (code === 401 || code === 403) return "The model rejected this key.";
    if (code === 429) return "This key is rate-limited right now.";
    if (code === 404) return "The model name was rejected.";
    return `The model returned ${code}.`;
  }
  if (NETWORK_ERROR.test(scrubbed)) {
    return "The browser couldn't reach the model. The key stayed on this page.";
  }
  return "The model didn't answer.";
}

async function callModel(text: string, key: OwnKey): Promise<unknown> {
  const call = key.provider === "gemini"
    ? buildGeminiCall(text, key.secret, DEFAULT_GEMINI_MODEL)
    : buildOpenAICompatCall(text, {
        baseUrl: GROQ_BASE_URL,
        apiKey: key.secret,
        model: DEFAULT_GROQ_MODEL,
      });
  if (call.url.includes(key.secret)) {
    throw new Error("Refusing to put the key in the model URL.");
  }
  const res = await postWithRetry(call.url, call.init);
  const body: unknown = await res.json().catch(() => null);
  if (key.provider === "gemini") {
    const args = readGeminiToolArgs(body);
    if (args === undefined) throw new Error("Gemini did not return a reading.");
    return args;
  }
  const argument = readOpenAIToolArguments(body);
  if (!argument) throw new Error(`${ownProvider(key.provider).label} did not return a reading.`);
  try {
    return JSON.parse(argument) as unknown;
  } catch {
    throw new Error(`${ownProvider(key.provider).label} returned a reading that was not valid JSON.`);
  }
}

async function postWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      if (res.ok) return res;
      const error = new Error(`status ${res.status}`);
      if (!RETRYABLE_STATUS.has(res.status) || attempt === LLM_ATTEMPTS) throw error;
      lastError = error;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const status = Number(message.match(STATUS_ERROR)?.[1] ?? 0);
      // A 4xx other than a rate limit will not start working on a retry.
      // Network failures and 429/5xx get the remaining attempts.
      if (status !== 0 && !RETRYABLE_STATUS.has(status)) throw error;
      if (attempt === LLM_ATTEMPTS) throw error;
      lastError = error;
    }
    await sleep(250 * attempt);
  }
  throw lastError instanceof Error ? lastError : new Error("The call failed");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
