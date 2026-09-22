import { PraxisConfigError, PraxisInputError } from "../errors";
import type { PraxisServerConfig } from "../env";
import { envTimeout, fetchWithTimeout } from "../api/timeout";
import { logger } from "../observability/logger";
import { type DcaCadence } from "../stocks/schedules";
import { normalizeIntent } from "./intentNormalize";

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

const INTENT_TOOL_NAME = "parse_praxis_intent";

const intentTool = {
  name: INTENT_TOOL_NAME,
  description:
    "Parse a user's Praxis Solana request into safe typed actions, a clarification question, or an unsupported response.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["outcome"],
    properties: {
      outcome: {
        type: "string",
        enum: ["actions", "clarify", "unsupported"],
      },
      question: { type: "string" },
      options: {
        type: "array",
        items: { type: "string" },
      },
      message: { type: "string" },
      actions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: {
            kind: {
              type: "string",
              enum: ["transfer", "research", "swap_stub", "policy_question", "save_contact", "policy_change", "schedule_dca", "basket_buy"],
            },
            asset: {
              type: "string",
              description:
                "Asset symbol for a transfer: 'SOL' for native SOL, or an SPL token symbol like 'USDC'. Default 'SOL' if unspecified.",
            },
            amountHuman: {
              type: "string",
              description:
                "Human decimal amount exactly as intended, e.g. 0.5. Never convert to lamports. " +
                "Required for transfer, swap_stub, schedule_dca and basket_buy — on a swap it is " +
                "the amount of assetIn.",
            },
            recipient: {
              type: "string",
              description: "Saved contact label/name or pasted address.",
            },
            usdSigil: {
              type: "boolean",
              description:
                "True when the user wrote a dollar sign on the amount ('buy $40 openai'). The number is still a token quantity — this only records that they typed '$', so the reply can say which reading it took.",
            },
            toSelf: {
              type: "boolean",
              description:
                "For a transfer from a BUY verb with no recipient named ('buy $40 openai'): true, and omit recipient — it settles into the owner's own wallet. Never set this for send or sell; a send with no recipient is a clarify.",
            },
            token: {
              type: "string",
              description:
                "For research: the ticker or base58 mint EXACTLY as the user wrote it, with the " +
                "surrounding words stripped ('research about trump coin' -> 'trump'). Never invent " +
                "or complete a mint address — the server resolves the name and asks the user when a " +
                "ticker matches several mints.",
            },
            assetIn: {
              type: "string",
              description:
                "For swap_stub: the symbol being sold ('swap 100 USDC for JUP' -> 'USDC'; " +
                "'sell 40 OPENAI for SOL' -> 'OPENAI'). Required on every swap_stub.",
            },
            assetOut: {
              type: "string",
              description:
                "For swap_stub: the symbol being bought ('swap 100 USDC for JUP' -> 'JUP'). " +
                "Required on every swap_stub; a bare 'sell 40 OPENAI' with no named " +
                "counter-asset is a clarify, not a swap_stub with this field omitted.",
            },
            topic: {
              type: "string",
              enum: ["caps", "expiry", "allowlist", "pause", "general"],
              description:
                "For policy_question: which aspect the user asked about; 'general' for an overall explanation.",
            },
            label: {
              type: "string",
              description: "For save_contact: the human alias to save the address under.",
            },
            address: {
              type: "string",
              description: "For save_contact: the base58 address to save.",
            },
            field: {
              type: "string",
              enum: ["daily_limit", "max_per_tx", "expiry", "pause"],
              description:
                "For policy_change: which policy knob to change. 'daily_limit' / 'max_per_tx' use amountHuman; 'expiry' uses expiryHours; 'pause' uses paused.",
            },
            expiryHours: {
              type: "number",
              description: "For policy_change expiry: hours from now to extend the agent session.",
            },
            paused: {
              type: "boolean",
              description: "For policy_change pause: true to pause the agent, false to unpause/resume.",
            },
            cadence: {
              // Declared field by field, not described in prose. A bare
              // `{type: "object"}` leaves the shape to be inferred, and a
              // small model infers it wrong — every recurring buy came back
              // with an unusable cadence and fell through to the fallback.
              type: "object",
              description: "For schedule_dca: how often the buy repeats.",
              required: ["type"],
              properties: {
                type: {
                  type: "string",
                  enum: ["daily", "weekly", "monthly"],
                  description: "Repeat interval.",
                },
                weekday: {
                  type: "integer",
                  description: "For weekly: 0-6, Sunday = 0. 'every Monday' is 1.",
                },
                day: {
                  type: "integer",
                  description: "For monthly: day of month, 1-31.",
                },
              },
            },
            basket: {
              type: "string",
              description: "For basket_buy: basket name (index, ai). Total USD in amountHuman.",
            },
          },
        },
      },
    },
  },
};

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
/**
 * A moving alias, and the lite tier. Both halves are deliberate.
 *
 * `-latest` rather than a pin: the pinned `gemini-2.5-flash` was retired for
 * API keys issued now and started answering 404. Nothing broke loudly,
 * because `parseIntent` catches every Gemini failure and falls back to the
 * regex parser — so the product kept replying, with a parser that reads
 * "research about trump coin" as the token "ABOUT". A name that rots
 * silently demotes the whole product to its fallback. (`gemini-2.5-flash-lite`
 * is a real model name and 404s the same way; the whole 2.5 family does.)
 *
 * `flash-lite` rather than `flash`: measured, not assumed. Free-tier
 * `gemini-flash-latest` allows twenty requests PER DAY
 * (GenerateRequestsPerDayPerProjectPerModel-FreeTier = 20), and request
 * twenty-one is a 429 — which lands in that same silent fallback. A parser
 * that degrades after twenty messages is the bug above with a different
 * cause. Flash-lite has real daily headroom, answers in ~0.9s against ~8s,
 * and, once the tool schema stopped leaving nested shapes to inference,
 * scored 17/17 on a sweep of the intents this repo pins.
 *
 * Both are overridable with GEMINI_MODEL. Anyone on a paid key with no
 * daily cap should reach for full flash on the harder end of free-form
 * phrasing; this default is chosen for the tier the README tells people to
 * sign up for.
 */
const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";

const INTENT_SYSTEM_PROMPT = [
  "You parse user text for Praxis, a Solana agent protected by Aegis.",
  "Return exactly one tool call.",
  "Supported actions: native SOL transfer, read-only token research, swap_stub, policy_question, save_contact, and policy_change.",
  "Swaps are not executable yet; emit swap_stub, never pretend agent_swap exists.",
  "Stock verbs: buy/purchase/acquire and sell map to transfer with a PreStocks symbol " +
    "(OPENAI, SPACEX, ANTHROPIC, ANDURIL, FIGUREAI, KALSHI, NEURALINK, POLYMARKET); " +
    "accept an optional p- prefix and any case (popenai = OPENAI).",
  "A '$' on the amount does NOT change the unit: 'buy $40 openai' is 40 OPENAI, not $40 of it. " +
    "Keep amountHuman as the bare number and set usdSigil=true so the reply can say so.",
  "A BUY with no recipient ('buy $40 openai') is a transfer with toSelf=true and no recipient: " +
    "it settles into the owner's own wallet. Only a buy verb may do this. A send with no " +
    "recipient is a clarify, and a bare sell is a swap idea — never set toSelf for either.",
  "sell AMOUNT <stock> for <asset> is a swap idea: emit swap_stub, never a transfer addressed to a ticker.",
  "Recurring-buy phrasing (buy/dca AMOUNT STOCK every <weekday>/daily/weekly/monthly, optionally " +
    "for RECIPIENT) is schedule_dca with cadence {type, weekday 0-6 Sunday-first, day 1-31}. " +
    "A schedule only EMITS proposals — each fire needs a signature, never auto-sign. " +
    "Basket phrasing (buy [AMOUNT] [of] <index|ai|basket> [for RECIPIENT]) is basket_buy with " +
    "the basket name and total USD in amountHuman. Never split a basket into transfers yourself: " +
    "the executor simulates every constituent and clarifies the whole basket if any is blocked. " +
    "Unknown basket names must be clarify, never a guessed split.",
  "research: put the token in `token` EXACTLY as the user wrote it — a ticker like 'trump' " +
    "or a base58 mint. NEVER invent, complete or recall a mint address, and never substitute a " +
    "ticker you think they meant. The server resolves the name against a live index and asks " +
    "the user which one when a ticker matches several mints, which it often does. " +
    "If the user gives both a ticker and a mint, send the mint. Strip the surrounding words " +
    "('research about trump coin' -> token 'trump'), and keep the case of a mint exactly.",
  "Never emit buy/sell/hold advice. Research is neutral data only.",
  "policy_question: when the user ASKS ABOUT their own policy, limits, caps, session expiry, pause state, allow-lists, or how Praxis keeps them safe. Pick the closest topic, or 'general'.",
  "policy_change: when the user wants to CHANGE a policy setting. 'change/raise/lower/set my daily limit to N SOL' -> field=daily_limit, amountHuman=N. 'set max per tx to N SOL' -> field=max_per_tx, amountHuman=N. 'extend my session by N hours/days' or 'set expiry to N hours' -> field=expiry, expiryHours=N (convert days to hours). 'pause/freeze the agent' -> field=pause, paused=true. 'unpause/resume the agent' -> field=pause, paused=false. Distinguish a CHANGE (imperative: change/set/raise/lower/pause) from a QUESTION (what/how/is my...).",
  "save_contact: when the user asks to save/remember an address under a name. Extract the base58 address and the label separately.",
  "Decompose multi-step requests in order. 'send X to ADDR and save as LABEL' is TWO actions: a transfer (recipient = ADDR) and a save_contact (address = ADDR, label = LABEL). Never fold 'and save as ...' into the recipient.",
  "Handle misspellings, shorthand, slang, and multiple steps in order.",
  "If the amount, recipient, asset, token, or action is ambiguous, outcome must be clarify.",
  "Never guess. One clarifying question is safer than one wrong transaction.",
].join(" ");

/**
 * Gemini's free tier answers 429/503 under load often enough that a single
 * hiccup would otherwise demote the request to the regex fallback. The call
 * is a pure read, so retrying it is safe; a 4xx that is not a rate limit is
 * a real error (bad key, retired model) and fails straight through.
 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const LLM_ATTEMPTS = 3;

/** One configured LLM parser, ready to run. */
export interface IntentAttempt {
  name: string;
  parse: (text: string) => Promise<ParsedIntent>;
}

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

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

  const res = await geminiWithRetry(model, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": config.geminiApiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: INTENT_SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text }] }],
      tools: [
        {
          functionDeclarations: [
            {
              name: INTENT_TOOL_NAME,
              description: intentTool.description,
              parameters: toGeminiSchema(intentTool.input_schema),
            },
          ],
        },
      ],
      // Force exactly one call to our intent tool, mirroring Anthropic's tool_choice.
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: [INTENT_TOOL_NAME],
        },
      },
      generationConfig: { temperature: 0, maxOutputTokens: 700 },
    }),
  });

  const body = await res.json();
  const parts: Array<{ functionCall?: { name?: string; args?: unknown } }> | undefined =
    body?.candidates?.[0]?.content?.parts;
  const call = Array.isArray(parts)
    ? (parts.find((part) => part.functionCall?.name === INTENT_TOOL_NAME)
        ?? parts.find((part) => part.functionCall))
    : undefined;

  if (!call?.functionCall?.args) {
    throw new PraxisInputError("Gemini did not return the expected intent tool output.");
  }

  return normalizeIntent(call.functionCall.args);
}

/**
 * One Gemini call, retried on transient failures. Throws with the model name
 * in the message: the failure mode that started all of this was a retired
 * model answering 404, and "(404)" alone does not tell an operator which name
 * to change.
 */
async function geminiWithRetry(model: string, init: RequestInit): Promise<Response> {
  return postWithRetry(
    `${GEMINI_API_BASE}/${model}:generateContent`,
    init,
    { provider: "gemini", model },
  );
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

  const res = await postWithRetry(
    `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        // System first, tools next, the user turn last: a stable prefix is
        // what prompt caching keys on, and on Groq's gpt-oss models cached
        // tokens are excluded from the rate limits. ~96% of this request is
        // byte-identical every call, so the ordering is load-bearing.
        messages: [
          { role: "system", content: INTENT_SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: INTENT_TOOL_NAME,
              description: intentTool.description,
              parameters: intentTool.input_schema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: INTENT_TOOL_NAME } },
        temperature: 0,
      }),
    },
    { provider: provider.name, model: provider.model },
  );

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

  const call = body?.choices?.[0]?.message?.tool_calls?.find(
    (t: { function?: { name?: string } }) => t.function?.name === INTENT_TOOL_NAME,
  ) ?? body?.choices?.[0]?.message?.tool_calls?.[0];

  if (!call?.function?.arguments) {
    throw new PraxisInputError(`${provider.name} did not return the expected intent tool call.`);
  }

  let args: unknown;
  try {
    args = JSON.parse(call.function.arguments);
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

/**
 * Gemini's function-declaration schema is an OpenAPI subset: it expects uppercase
 * `type` values and rejects `additionalProperties`. Translate our shared tool
 * schema at the boundary so the schema stays a single source of truth.
 */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "additionalProperties") continue;
    if (key === "type" && typeof value === "string") {
      out[key] = value.toUpperCase();
      continue;
    }
    out[key] = toGeminiSchema(value);
  }
  return out;
}

export { parseIntentLocallyForDemo } from "./localIntent";
