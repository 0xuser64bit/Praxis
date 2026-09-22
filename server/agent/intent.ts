import { PublicKey } from "@solana/web3.js";

import { PraxisConfigError, PraxisInputError } from "../errors";
import type { PraxisServerConfig } from "../env";
import { envTimeout, fetchWithTimeout } from "../api/timeout";
import { logger } from "../observability/logger";
import { STOCK_SYMBOLS, normalizeStockAlias } from "../stocks/universe";
import {
  availableBaskets,
  parseCadence,
  resolveBasket,
  type DcaCadence,
} from "../stocks/schedules";
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

/** Common token names → symbols the research resolver understands. */
const TOKEN_ALIASES: Record<string, string> = {
  sol: "SOL",
  solana: "SOL",
  usdc: "USDC",
  jup: "JUP",
  jupiter: "JUP",
  bonk: "BONK",
  // Stocklana C04: PreStocks symbols, bare and p-prefixed, for research + transfer phrasing.
  ...Object.fromEntries(
    STOCK_SYMBOLS.flatMap((s) => {
      const lower = s.toLowerCase();
      return [
        [lower, s],
        [`p${lower}`, s],
      ];
    }),
  ),
};

function normalizeToken(word: string): string {
  const key = word.replace(/^\$/, "").toLowerCase();
  return TOKEN_ALIASES[key] ?? key.toUpperCase();
}

/**
 * Words that are never the token being asked about.
 *
 * The old parser took the first word after the verb and an optional fixed
 * preposition, so "research about trump coin" asked for the token "ABOUT"
 * and "research for this coin TRUMP" asked for "THIS". A fixed list of
 * prepositions cannot keep up with how people actually type; skipping filler
 * until a real word appears can.
 *
 * ponytail: a deny-list, so a token literally named DATA or INFO is skipped.
 * A "$" prefix ("$data") and a pasted mint both override it, which is the
 * escape hatch; a live symbol index would be the upgrade if it ever matters.
 */
const RESEARCH_FILLER = new Set([
  "a", "about", "all", "an", "and", "any", "anything", "are", "as", "at", "be", "can",
  "chart", "charts", "check", "coin", "coins", "crypto", "currently", "data", "detail",
  "details", "do", "does", "doing", "dyor", "find", "for", "get", "give", "going", "good",
  "how", "i", "in", "info", "information", "is", "it", "its", "just", "know", "latest",
  "like", "look", "lookup", "looks", "me", "mint", "more", "much", "my", "now", "of", "on",
  "one", "out", "over", "please", "price", "prices", "project", "research", "right", "see",
  "show", "some", "stats", "status", "tell", "that", "the", "their", "there", "these",
  "they", "think", "this", "to", "today", "token", "tokens", "up", "us", "want", "was",
  "week", "what", "whats", "which", "why", "with", "worth", "you", "your",
]);

/** Verbs and phrasings that introduce a research request. */
const RESEARCH_VERB =
  /\b(?:research|check|look\s*up|lookup|what'?s|how'?s|how is|price|chart|stats|tell me about|dyor|info on|analy[sz]e)\b/;

/**
 * A pasted mint anywhere in the line, validated as a real 32-byte key.
 *
 * Address beats ticker: "research this coin TRUMP, mint: 6p6x…" names the
 * same thing twice and only one of the two is unambiguous. It also rescues
 * the case a word matcher handles worst — a bare address, where every
 * surrounding word is filler and the address itself is not a word at all.
 */
function findMintAddress(text: string): string | null {
  for (const candidate of text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) ?? []) {
    try {
      return new PublicKey(candidate).toBase58();
    } catch {
      // Right alphabet, wrong length or curve — keep scanning the line.
    }
  }
  return null;
}

/** First word in `tail` that could be a ticker. A "$" forces a word through. */
function firstTokenWord(tail: string): string | null {
  for (const raw of tail.split(/[^a-zA-Z0-9$]+/)) {
    if (!raw) continue;
    const sigil = raw.startsWith("$");
    const word = raw.replace(/^\$/, "");
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,11}$/.test(word)) continue;
    if (!sigil && RESEARCH_FILLER.has(word.toLowerCase())) continue;
    return word;
  }
  return null;
}

/**
 * Best-effort research detection for the offline fallback parser. Catches
 * pasted mints, verb-led ("research about trump coin", "price of jup"),
 * token-led ("solana price now", "bonk chart"), and bare words ("sol", "$bonk").
 */
function matchResearch(text: string): string | null {
  const mint = findMintAddress(text);
  if (mint) return mint;

  const t = text.toLowerCase();
  // token-led first so "solana price now" resolves to the token, not "now".
  const led = t.match(/\$?([a-z][a-z0-9]{1,11})\s+(?:price|chart|stats|doing|now|today)\b/);
  if (led && !RESEARCH_FILLER.has(led[1])) return normalizeToken(led[1]);

  // verb-led: skip filler after the verb rather than guessing the preposition.
  const verb = t.match(RESEARCH_VERB);
  if (verb && verb.index !== undefined) {
    const word = firstTokenWord(text.slice(verb.index + verb[0].length));
    if (word) return normalizeToken(word);
  }

  // bare token word/symbol on its own.
  const bare = t.replace(/[^a-z0-9$]/g, "").replace(/^\$/, "");
  if (TOKEN_ALIASES[bare]) return TOKEN_ALIASES[bare];
  return null;
}

export function parseIntentLocallyForDemo(text: string): ParsedIntent {
  const cleaned = text.trim().replace(/\s+/g, " ");

  // Stocklana C06: mechanical recurring buy → schedule (fires emit proposals).
  const dca = matchDca(cleaned);
  if (dca) return { outcome: "actions", actions: [dca] };

  // Stocklana C06: atomic basket buy → per-constituent proposals, all-or-clarify.
  const basket = matchBasket(cleaned);
  if (basket) return { outcome: "actions", actions: [basket] };

  // Unknown basket phrasing (no parseable name/amount) clarifies with the menu.
  if (isBasketRequest(cleaned)) {
    return {
      outcome: "clarify",
      question:
        "I can buy baskets atomically — which one, and how much total? " +
        `Available: ${availableBaskets().join(", ")} (e.g. "buy ai basket $50").`,
    };
  }

  const send = cleaned.match(/^(?:s(?:end|nd)|buy|sell)\s+\$?\s*([0-9]+(?:\.[0-9]+)?)\s*([a-z0-9$]+)?\s+(?:to|2|for)\s+(.+)$/i);
  if (send) {
    // Recurring phrasing the DCA matcher couldn't parse (e.g. an unknown
    // cadence word) — offer a one-time buy rather than guessing a schedule.
    if (hasRecurringCadence(cleaned)) {
      return {
        outcome: "clarify",
        question:
          "I couldn't parse that schedule — want to do a one-time buy instead? " +
          'Tell me the amount, the stock, and who receives it (or use "every Monday", "weekly", "monthly").',
      };
    }
    const asset = normalizeStockAlias(send[2] ?? "sol");
    const amountHuman = send[1];
    // "ADDR and save (this address) as LABEL" → transfer + save_contact.
    const saveTail = send[3].match(/^(.*?)\s+(?:and\s+)?save\s+(?:this\s+address\s+|it\s+|that\s+)?as\s+(.+)$/i);
    if (saveTail) {
      const address = saveTail[1].trim();
      const label = saveTail[2].trim().replace(/[.?!]+$/, "");
      return {
        outcome: "actions",
        actions: [
          { kind: "save_contact", address, label },
          { kind: "transfer", asset, amountHuman, recipient: address },
        ],
      };
    }
    return {
      outcome: "actions",
      actions: [
        {
          kind: "transfer",
          asset,
          amountHuman,
          recipient: send[3].trim(),
          ...(hasUsdSigil(cleaned) ? { usdSigil: true as const } : {}),
        },
      ],
    };
  }

  // A buy with no recipient settles into the owner's own vault — the same
  // default a recurring buy already takes. Runs after the basket and DCA
  // matchers (so "buy $100 index" and "buy $50 spacex every monday" keep
  // their meaning) and after the shape above (so a named recipient wins).
  //
  // Buy verbs only. A bare `sell` is a swap idea, not a transfer to yourself,
  // and a bare `send` is a sentence with a word missing — both still clarify.
  const bareBuy = cleaned.match(
    /^(?:buy|purchase|acquire)\s+\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:of\s+|in\s+)?\$?([a-z][a-z0-9]{1,11})\s*[.!]?\s*$/i,
  );
  if (bareBuy) {
    return {
      outcome: "actions",
      actions: [
        {
          kind: "transfer",
          asset: normalizeStockAlias(bareBuy[2]),
          amountHuman: bareBuy[1],
          toSelf: true,
          ...(hasUsdSigil(cleaned) ? { usdSigil: true as const } : {}),
        },
      ],
    };
  }

  const save = cleaned.match(/^save\s+(\S+)\s+as\s+(.+)$/i);
  if (save) {
    return {
      outcome: "actions",
      actions: [{ kind: "save_contact", address: save[1].trim(), label: save[2].trim().replace(/[.?!]+$/, "") }],
    };
  }

  // policy_change (a mutation) must be checked before policy_question (a read),
  // so imperative phrasing like "pause the agent" isn't swallowed as a question.
  const policyChange = matchPolicyChange(cleaned);
  if (policyChange) {
    return { outcome: "actions", actions: [policyChange] };
  }

  const policyTopic = matchPolicyQuestion(cleaned);
  if (policyTopic) {
    return { outcome: "actions", actions: [{ kind: "policy_question", topic: policyTopic }] };
  }

  const swap = cleaned.match(/^swap\s+([0-9]+(?:\.[0-9]+)?)\s+([a-z0-9$]+)\s+(?:for|into|to)\s+([a-z0-9$]+)/i);
  if (swap) {
    return {
      outcome: "actions",
      actions: [{ kind: "swap_stub", amountHuman: swap[1], assetIn: swap[2], assetOut: swap[3] }],
    };
  }

  const researchToken = matchResearch(cleaned);
  if (researchToken) {
    return { outcome: "actions", actions: [{ kind: "research", token: researchToken }] };
  }

  // Bare recurring phrasing (no DCA shape) clarifies with the syntax.
  if (hasRecurringCadence(cleaned)) {
    return {
      outcome: "clarify",
      question:
        "To schedule a recurring buy, tell me the amount, the stock, and the cadence — " +
        'e.g. "buy $50 openai every Monday". Who should receive it? (Defaults to your wallet.)',
    };
  }

  return {
    outcome: "clarify",
    question: "Do you want to send SOL, research a token, save a contact, ask about your policy, or preview a swap stub?",
  };
}

/**
 * Detect an imperative policy CHANGE in the offline fallback parser. Conservative
 * on purpose: it only fires on explicit change verbs + a policy knob, so a normal
 * transfer ("send 10 sol to alex") can never be mistaken for a limit change.
 */
/**
 * Did the user put a dollar sign on the amount? The amount regexes strip it,
 * so the fact has to be read off the original line.
 */
function hasUsdSigil(text: string): boolean {
  return /(?:^|\s)\$\s*[0-9]/.test(text);
}

function matchPolicyChange(text: string): Extract<ParsedAction, { kind: "policy_change" }> | null {
  const t = text.toLowerCase().trim();

  // pause / unpause the agent.
  if (/\b(unpause|un-pause|resume|re-enable transfers)\b/.test(t) && /\b(agent|transfers?|aegis|it)\b/.test(t)) {
    return { kind: "policy_change", field: "pause", paused: false };
  }
  if (/^(pause|freeze|halt|disable)\b/.test(t) && /\b(agent|transfers?|aegis|spending|it|everything)\b/.test(t)) {
    return { kind: "policy_change", field: "pause", paused: true };
  }

  // expiry: "extend my session by 24 hours", "set expiry to 12 hours / 2 days".
  const expiry = t.match(
    /\b(?:extend|set|change|update)\b.*?\b(?:session|expiry|expiration)\b.*?\b(\d+(?:\.\d+)?)\s*(hour|hr|h|day|d)s?\b/,
  ) ?? t.match(/\bextend\b.*?\b(\d+(?:\.\d+)?)\s*(hour|hr|h|day|d)s?\b/);
  if (expiry) {
    const n = Number(expiry[1]);
    const isDays = /^d/.test(expiry[2]);
    if (Number.isFinite(n) && n > 0) {
      return { kind: "policy_change", field: "expiry", expiryHours: isDays ? n * 24 : n };
    }
  }

  // caps: "change/raise/lower/set ... (daily) limit/cap | max per tx ... to N (sol)".
  const cap = t.match(
    /\b(?:change|set|raise|lower|increase|decrease|bump|update|make)\b[^]*?\b(daily limit|daily cap|per[\s-]?tx|per transaction|max per tx|max[\s-]?per[\s-]?tx|max|limit|cap)\b[^]*?\b(?:to|=)\s*\$?(\d+(?:\.\d+)?)\s*(?:sol)?\b/,
  );
  if (cap) {
    const knob = cap[1];
    const amountHuman = cap[2];
    const isPerTx = /per|max/.test(knob) && !/daily/.test(knob);
    return {
      kind: "policy_change",
      field: isPerTx ? "max_per_tx" : "daily_limit",
      amountHuman,
    };
  }

  return null;
}

/** Stocklana C06: mechanical recurring buy ("buy $50 openai every monday", "dca 10 openai weekly"). */
function matchDca(text: string): Extract<ParsedAction, { kind: "schedule_dca" }> | null {
  const CADENCE = "every\\s+[a-z]+|daily|weekly|monthly";
  // People put the recipient on either side of the cadence, and both read
  // naturally: "buy 10 openai for maya every monday" and "buy 10 openai every
  // monday for maya". Only the first used to parse; the second fell through to
  // a clarify, which makes the feature look broken for half the phrasings.
  const shapes: Array<{ re: RegExp; recipient: 3 | 4; cadence: 3 | 4 }> = [
    {
      re: new RegExp(
        `^(?:buy|dca)\\s+\\$?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*([a-z0-9$]+)?\\s*(?:for\\s+(.+?))?\\s+(${CADENCE})\\s*$`,
        "i",
      ),
      recipient: 3,
      cadence: 4,
    },
    {
      re: new RegExp(
        `^(?:buy|dca)\\s+\\$?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*([a-z0-9$]+)?\\s+(${CADENCE})\\s+for\\s+(.+?)\\s*$`,
        "i",
      ),
      recipient: 4,
      cadence: 3,
    },
  ];

  for (const shape of shapes) {
    const m = text.match(shape.re);
    if (!m) continue;
    const cadence = parseCadence(m[shape.cadence].trim());
    if (!cadence) continue;
    return {
      kind: "schedule_dca",
      asset: normalizeStockAlias(m[2] ?? "sol"),
      amountHuman: m[1],
      recipient: m[shape.recipient]?.trim().replace(/[.?!]+$/, "") || undefined,
      cadence,
    };
  }
  return null;
}

/**
 * Stocklana C06: atomic basket buy. "buy ai basket $50 [for maya]",
 * "buy $100 [of] index [for maya]". Only known baskets parse — anything else
 * falls through to the clarify menu (never a guessed split).
 */
function matchBasket(text: string): Extract<ParsedAction, { kind: "basket_buy" }> | null {
  // Each shape maps to [name, amountHuman, recipient] group indices.
  const shapes: Array<{ re: RegExp; name: number; amount: number }> = [
    // "buy ai basket $50 [for maya]"
    { re: /^buy\s+([a-z][a-z0-9\s]*?)\s+\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:for\s+(.+))?$/i, name: 1, amount: 2 },
    // "buy $100 [of] index [for maya]"
    { re: /^buy\s+\$?\s*([0-9]+(?:\.[0-9]+)?)\s+(?:of\s+|in\s+)?([a-z][a-z0-9\s]*?)\s*(?:for\s+(.+))?$/i, name: 2, amount: 1 },
  ];
  for (const { re, name, amount } of shapes) {
    const m = text.match(re);
    if (!m) continue;
    const basketName = (m[name] ?? "").trim();
    if (!resolveBasket(basketName)) continue;
    const recipient = m[3]?.trim().replace(/[.?!]+$/, "") || undefined;
    return { kind: "basket_buy", basket: basketName, amountHuman: m[amount], recipient };
  }
  return null;
}

/** Basket phrasing that matched no known basket (clarify menu fallback). */
function isBasketRequest(text: string): boolean {
  return /\bbasket\b|\bindex fund\b|\bprestocks index\b|\bbuy the index\b/i.test(text);
}

/**
 * Stocklana C04: recurring-buy phrasing has no scheduler yet (C06 builds it).
 * Note: "daily" is included, so this gate must run AFTER the policy_change /
 * policy_question matchers — "change my daily limit" is a cap edit, not DCA.
 */
function hasRecurringCadence(text: string): boolean {
  return (
    /\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|day|week|month|morning)\b/i.test(text) ||
    /\b(weekly|monthly|daily|recurring|auto-?buy)\b/i.test(text) ||
    /\bdca\b/i.test(text)
  );
}

/** Classify a policy question into a topic, or null if it isn't one. */
function matchPolicyQuestion(text: string): "caps" | "expiry" | "allowlist" | "pause" | "general" | null {
  const t = text.toLowerCase();
  if (/\bexpir|\bsession\b/.test(t)) return "expiry";
  if (/\bpaus/.test(t)) return "pause";
  if (/\ballow.?list|allowed (recipient|address|program)/.test(t)) return "allowlist";
  if (/\b(daily )?(limit|cap)\b|how much can/.test(t)) return "caps";
  if (/\bpolicy\b|keep me safe|how (does|do|am i).*safe|am i safe/.test(t)) return "general";
  return null;
}

