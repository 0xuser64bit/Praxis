import { PraxisConfigError, PraxisInputError } from "../errors";
import type { PraxisServerConfig } from "../env";
import { envTimeout, fetchWithTimeout } from "../api/timeout";
import { logger } from "../observability/logger";
import { type DcaCadence } from "../stocks/schedules";
import { normalizeIntent } from "./intentNormalize";
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
} from "./intentRequest";

export type ParsedIntent =
  | { outcome: "clarify"; question: string; options?: string[] }
  | { outcome: "actions"; actions: ParsedAction[] }
  | { outcome: "unsupported"; message: string };

export type ParsedAction =
  | {
      kind: "transfer";
      /** Asset symbol: "SOL" (native) or an SPL token symbol like "USDC". */
      asset: string;
      amountHuman: string;
      /**
       * Saved contact label, or a pasted address. Absent only alongside
       * `toSelf` — never on its own.
       */
      recipient?: string;
      /**
       * The owner's own wallet is the destination, and no recipient was named.
       *
       * An explicit flag rather than "recipient is missing", because those are
       * different sentences: "buy $40 OPENAI" means *for me*, while "send 0.5
       * SOL" with the recipient dropped means the parser lost something. If
       * absence alone implied self, a model that forgot the field would turn
       * "send 5 SOL to alex" into a self-transfer. Only buy verbs set this —
       * a bare `sell` is a swap idea, not a transfer to yourself, and a bare
       * `send` still clarifies.
       *
       * Safe as a default because the destination is the owner's own wallet:
       * the agent is moving your money to you, still inside the Aegis
       * envelope (and still refused if your recipient allow-list excludes it).
       */
      toSelf?: true;
      /**
       * The user wrote a dollar sign on the amount ("buy $40 openai").
       *
       * It is NOT a unit here — the number is a token quantity, which is what
       * the program's caps, stored schedules and `praxis:stocksbuycheck` all
       * already mean by it. Redefining it as dollars would silently change
       * what every existing schedule buys and would un-break the over-cap
       * demo that proves the thesis.
       *
       * But "$40" and "40 tokens" can be two hundred times apart, so the
       * sigil is carried through rather than dropped at the regex, and the
       * reply says which reading it took. The number on the card is the truth;
       * this makes sure nobody has to infer that.
       */
      usdSigil?: true;
    }
  | {
      kind: "research";
      token: string;
    }
  | {
      kind: "swap_stub";
      amountHuman: string;
      assetIn: string;
      assetOut: string;
    }
  | {
      kind: "policy_question";
      topic: "caps" | "expiry" | "allowlist" | "pause" | "general";
    }
  | {
      kind: "save_contact";
      label: string;
      address: string;
    }
  | {
      kind: "policy_change";
      /** Which policy knob the owner wants to change. */
      field: "daily_limit" | "max_per_tx" | "expiry" | "pause";
      /** For daily_limit / max_per_tx: the new human SOL amount, e.g. "10". */
      amountHuman?: string;
      /** For expiry: hours from now to extend the agent session, e.g. 24. */
      expiryHours?: number;
      /** For pause: true to pause the agent, false to unpause/resume it. */
      paused?: boolean;
    }
  | {
      /** Stocklana C06: mechanical recurring buy. Creates a schedule; each
       *  fire emits a transfer proposal through the same policy checks.
       *  Never signs — every fire needs a signature. */
      kind: "schedule_dca";
      asset: string;
      amountHuman: string;
      /** Saved label/address, or undefined for the owner's own wallet. */
      recipient?: string;
      cadence: DcaCadence;
    }
  | {
      /** Stocklana C06: atomic multi-stock buy. Total USD split equally across
       *  the basket via PreStocks prices. All-or-clarify: any blocked or
       *  unpriceable constituent clarifies the whole basket, storing nothing. */
      kind: "basket_buy";
      basket: string;
      /** Total USD for the whole basket, e.g. "100". */
      amountHuman: string;
      /** Saved label/address, or undefined for the owner's own wallet. */
      recipient?: string;
    };


/** One configured LLM parser, ready to run. */
export interface IntentAttempt {
  name: string;
  parse: (text: string) => Promise<ParsedIntent>;
}


/**
 * The parsers to try, in the configured order, skipping any with no key.
 *
 * Free-tier quotas are per-provider and per-model, so chaining two vendors
 * is not redundancy for its own sake — it is the only thing that keeps a
 * parse working after one of them runs out for the day. Both entries below
 * score 17/17 on the intent sweep in `server/agent/__tests__`, so falling
 * from one to the other changes latency, never the answer.
 */
export function intentAttempts(config: PraxisServerConfig): IntentAttempt[] {
  const attempts: IntentAttempt[] = [];
  for (const name of config.intentProviders) {
    if (name === "gemini" && config.geminiApiKey) {
      attempts.push({ name, parse: (text) => parseIntentWithGemini(text, config) });
    }
    if (name === "groq" && config.groqApiKey) {
      attempts.push({
        name,
        parse: (text) =>
          parseIntentWithOpenAICompat(text, {
            name: "groq",
            baseUrl: GROQ_BASE_URL,
            apiKey: config.groqApiKey!,
            model: config.groqModel?.trim() || DEFAULT_GROQ_MODEL,
          }),
      });
    }
  }
  return attempts;
}

export async function parseIntentWithGemini(text: string, config: PraxisServerConfig): Promise<ParsedIntent> {
  if (!config.geminiApiKey) {
    throw new PraxisConfigError("GEMINI_API_KEY is required for intent parsing.");
  }
  const model = config.geminiModel ?? DEFAULT_GEMINI_MODEL;
  const call = buildGeminiCall(text, config.geminiApiKey, model);
  const res = await postWithRetry(call.url, call.init, { provider: "gemini", model });
  const args = readGeminiToolArgs(await res.json());
  if (args === undefined) {
    throw new PraxisInputError("Gemini did not return the expected intent tool output.");
  }
  return normalizeIntent(args);
}

/**
 * One LLM call, retried on transient failures. Throws with the provider and
 * model in the message: the failure that started all of this was a retired
 * model answering 404, and "(404)" alone does not say which name to change.
 */
async function postWithRetry(
  url: string,
  init: RequestInit,
  who: { provider: string; model: string },
): Promise<Response> {
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
    const res = await fetchWithTimeout(
      url,
      init,
      { ms: envTimeout("PRAXIS_LLM_TIMEOUT_MS", 15_000), label: `${who.provider} intent parsing` },
    );
    if (res.ok) return res;

    lastStatus = res.status;
    lastBody = await res.text();
    if (!RETRYABLE_STATUS.has(res.status) || attempt === LLM_ATTEMPTS) break;
    logger.warn("intent.llm_retry", { ...who, status: res.status, attempt });
    await sleep(250 * attempt);
  }
  throw new Error(
    `${who.provider} intent parsing failed for model "${who.model}" (${lastStatus}): ${lastBody.slice(0, 400)}`,
  );
}

/**
 * Groq, Cerebras, OpenRouter, Together, Mistral — one transport.
 *
 * They all speak OpenAI's chat-completions shape, which means the tool
 * schema goes over the wire exactly as written: no `toGeminiSchema`
 * translation, no uppercased types, no stripped `additionalProperties`.
 * The schema this repo maintains is the schema the model is handed.
 */
export interface OpenAICompatProvider {
  /** For logs and error messages. */
  name: string;
  /** Chat-completions endpoint, e.g. https://api.groq.com/openai/v1. */
  baseUrl: string;
  apiKey: string;
  model: string;
}

export async function parseIntentWithOpenAICompat(
  text: string,
  provider: OpenAICompatProvider,
): Promise<ParsedIntent> {
  if (!provider.apiKey) {
    throw new PraxisConfigError(`${provider.name} is missing an API key.`);
  }

  const call = buildOpenAICompatCall(text, provider);
  const res = await postWithRetry(call.url, call.init, { provider: provider.name, model: provider.model });
  const body = await res.json();

  // Token spend, and how much of it was served from cache. The failure this
  // whole path keeps hitting is a quota running out silently, and the only
  // way to see that coming is to watch what each parse actually costs.
  // On Groq's gpt-oss models cached tokens are excluded from the rate
  // limits, so `cached` is the number that decides the real ceiling.
  const usage = body?.usage;
  if (usage) {
    logger.info("intent.llm_usage", {
      provider: provider.name,
      model: provider.model,
      promptTokens: usage.prompt_tokens,
      cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
      completionTokens: usage.completion_tokens,
    });
  }

  const argument = readOpenAIToolArguments(body);
  if (!argument) {
    throw new PraxisInputError(`${provider.name} did not return the expected intent tool call.`);
  }

  let args: unknown;
  try {
    args = JSON.parse(argument);
  } catch {
    // Arguments come back as a JSON *string*; a truncated or malformed one
    // must not surface as a raw SyntaxError.
    throw new PraxisInputError(`${provider.name} returned tool arguments that were not valid JSON.`);
  }
  return normalizeIntent(args);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


export { parseIntentLocallyForDemo } from "./localIntent";
