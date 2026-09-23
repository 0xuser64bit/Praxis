/**
 * The intent-model request, with no server imports.
 *
 * The browser builds this same request with a key that stays in local
 * storage. The server builds it with the deployment's key. One schema, one
 * prompt, one model default — a second copy would drift, and a drifted
 * prompt is a different product.
 *
 * Nothing in this file may read the key from the environment, log it, or
 * persist it. Callers pass the key in and put it on the request header only.
 */

export const INTENT_TOOL_NAME = "parse_praxis_intent";

export const intentTool = {
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
                "For transfer, schedule_dca and a policy_change cap: true when the amount is in US dollars ('buy $40 openai', 'buy 40 dollars of spacex every monday', 'set my daily limit to $100'). Keep amountHuman as the bare number; the server converts dollars to a stock quantity at the live price. Omit when the user gave a token or SOL quantity ('buy 0.5 openai', 'set my daily limit to 2 SOL').",
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

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
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
export const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";

export const INTENT_SYSTEM_PROMPT = [
  "You parse user text for Praxis, a Solana agent protected by Aegis.",
  "Return exactly one tool call.",
  "Supported actions: native SOL transfer, read-only token research, swap_stub, policy_question, save_contact, and policy_change.",
  "Swaps are not executable yet; emit swap_stub, never pretend agent_swap exists.",
  "Stock verbs: buy/purchase/acquire and sell map to transfer with a PreStocks symbol " +
    "(OPENAI, SPACEX, ANTHROPIC, ANDURIL, FIGUREAI, KALSHI, NEURALINK, POLYMARKET); " +
    "accept an optional p- prefix and any case (popenai = OPENAI).",
  "A '$' (or 'dollars') on the amount means US dollars: 'buy $40 openai' is $40 worth of OPENAI. " +
    "Keep amountHuman as the bare number (40) and set usdSigil=true — the server converts it to a " +
    "quantity at the live PreStocks price. Without it ('buy 0.5 openai') the number is a token quantity.",
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
  "policy_change: when the user wants to CHANGE a policy setting. 'change/raise/lower/set my daily limit to N SOL' -> field=daily_limit, amountHuman=N. 'set max per tx to N SOL' -> field=max_per_tx, amountHuman=N. A dollar cap ('set my daily limit to $100') is the same field with amountHuman=100 and usdSigil=true — it applies to the stock envelope, never read it as SOL. 'extend my session by N hours/days' or 'set expiry to N hours' -> field=expiry, expiryHours=N (convert days to hours). 'pause/freeze the agent' -> field=pause, paused=true. 'unpause/resume the agent' -> field=pause, paused=false. Distinguish a CHANGE (imperative: change/set/raise/lower/pause) from a QUESTION (what/how/is my...).",
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
export const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
export const LLM_ATTEMPTS = 3;

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/**
 * Gemini's function-declaration schema is an OpenAPI subset: it expects uppercase
 * `type` values and rejects `additionalProperties`. Translate our shared tool
 * schema at the boundary so the schema stays a single source of truth.
 */
export function toGeminiSchema(schema: unknown): unknown {
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


export interface IntentCall {
  url: string;
  init: RequestInit;
}

/** Gemini generateContent. The key is a header, never part of the URL. */
export function buildGeminiCall(text: string, apiKey: string, model: string = DEFAULT_GEMINI_MODEL): IntentCall {
  return {
    url: `${GEMINI_API_BASE}/${model}:generateContent`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
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
        toolConfig: {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: [INTENT_TOOL_NAME],
          },
        },
        generationConfig: { temperature: 0, maxOutputTokens: 700 },
      }),
    },
  };
}

/**
 * OpenAI-compatible chat completions (Groq and the same shape elsewhere).
 *
 * System first, tools next, the user turn last: a stable prefix is what
 * prompt caching keys on, and on Groq's gpt-oss models cached tokens are
 * excluded from the rate limits. ~96% of this request is byte-identical
 * every call, so the ordering is load-bearing. The key is a header, never
 * part of the URL.
 */
export function buildOpenAICompatCall(
  text: string,
  provider: { baseUrl: string; apiKey: string; model: string },
): IntentCall {
  return {
    url: `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
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
  };
}

/** Tool arguments from a Gemini generateContent body, or undefined if the shape is missing. */
export function readGeminiToolArgs(body: unknown): unknown | undefined {
  if (!body || typeof body !== "object") return undefined;
  const candidates = (body as { candidates?: unknown }).candidates;
  const first = Array.isArray(candidates) ? candidates[0] : undefined;
  const parts = first && typeof first === "object"
    ? (first as { content?: { parts?: unknown } }).content?.parts
    : undefined;
  if (!Array.isArray(parts)) return undefined;

  const named = parts.find((part) => {
    if (!part || typeof part !== "object") return false;
    return (part as { functionCall?: { name?: string } }).functionCall?.name === INTENT_TOOL_NAME;
  });
  const anyCall = parts.find((part) => {
    if (!part || typeof part !== "object") return false;
    return Boolean((part as { functionCall?: unknown }).functionCall);
  });
  const chosen = named ?? anyCall;
  if (!chosen || typeof chosen !== "object") return undefined;
  const args = (chosen as { functionCall?: { args?: unknown } }).functionCall?.args;
  if (args === undefined || args === null) return undefined;
  return args;
}

/** Raw tool-argument string from an OpenAI-compatible chat completion. */
export function readOpenAIToolArguments(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const choices = (body as { choices?: unknown }).choices;
  const message = Array.isArray(choices) && choices[0] && typeof choices[0] === "object"
    ? (choices[0] as { message?: { tool_calls?: unknown } }).message
    : undefined;
  const calls = message?.tool_calls;
  if (!Array.isArray(calls)) return undefined;
  const named = calls.find((call) => {
    if (!call || typeof call !== "object") return false;
    return (call as { function?: { name?: string } }).function?.name === INTENT_TOOL_NAME;
  });
  const anyCall = calls.find((call) => call && typeof call === "object" && (call as { function?: unknown }).function);
  const chosen = named ?? anyCall;
  if (!chosen || typeof chosen !== "object") return undefined;
  const args = (chosen as { function?: { arguments?: unknown } }).function?.arguments;
  return typeof args === "string" ? args : undefined;
}
