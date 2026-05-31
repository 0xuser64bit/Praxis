import { PraxisConfigError, PraxisInputError } from "../errors";
import type { PraxisServerConfig } from "../env";
import { envTimeout, fetchWithTimeout } from "../api/timeout";

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
      recipient: string;
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
              enum: ["transfer", "research", "swap_stub"],
            },
            asset: {
              type: "string",
              description:
                "Asset symbol for a transfer: 'SOL' for native SOL, or an SPL token symbol like 'USDC'. Default 'SOL' if unspecified.",
            },
            amountHuman: {
              type: "string",
              description:
                "Human decimal amount exactly as intended, e.g. 0.5. Never convert to lamports.",
            },
            recipient: {
              type: "string",
              description: "Saved contact label/name or pasted address.",
            },
            token: {
              type: "string",
              description: "Token symbol or mint address for read-only research.",
            },
            assetIn: { type: "string" },
            assetOut: { type: "string" },
          },
        },
      },
    },
  },
};

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

const INTENT_SYSTEM_PROMPT = [
  "You parse user text for Praxis, a Solana agent protected by Aegis.",
  "Return exactly one tool call.",
  "Supported actions: native SOL transfer, read-only token research, and swap_stub.",
  "Swaps are not executable yet; emit swap_stub, never pretend agent_swap exists.",
  "Never emit buy/sell/hold advice. Research is neutral data only.",
  "Handle misspellings, shorthand, slang, and multiple steps in order.",
  "If the amount, recipient, asset, token, or action is ambiguous, outcome must be clarify.",
  "Never guess. One clarifying question is safer than one wrong transaction.",
].join(" ");

export async function parseIntentWithGemini(text: string, config: PraxisServerConfig): Promise<ParsedIntent> {
  if (!config.geminiApiKey) {
    throw new PraxisConfigError("GEMINI_API_KEY is required for intent parsing.");
  }
  const model = config.geminiModel ?? DEFAULT_GEMINI_MODEL;

  const res = await fetchWithTimeout(
    `${GEMINI_API_BASE}/${model}:generateContent`,
    {
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
    },
    {
      ms: envTimeout("PRAXIS_LLM_TIMEOUT_MS", 15_000),
      label: "Gemini intent parsing",
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini generateContent API failed (${res.status}): ${body}`);
  }

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
};

function normalizeToken(word: string): string {
  const key = word.replace(/^\$/, "").toLowerCase();
  return TOKEN_ALIASES[key] ?? key.toUpperCase();
}

/**
 * Best-effort research detection for the offline fallback parser. Catches
 * verb-led ("research bonk", "what's sol", "price of jup"), token-led
 * ("solana price now", "bonk chart"), and bare token words ("sol", "$bonk").
 */
function matchResearch(text: string): string | null {
  const t = text.toLowerCase();
  // token-led first so "solana price now" resolves to the token, not "now".
  let m = t.match(/\$?([a-z][a-z0-9]{1,11})\s+(?:price|chart|stats|doing|now|today)\b/);
  if (m) return normalizeToken(m[1]);
  // verb-led: research/check/what's/how's/price/chart [of|for|is|on] TOKEN
  m = t.match(
    /\b(?:research|check|what'?s|how'?s|how is|price|chart|stats|tell me about)\s+(?:of\s+|for\s+|is\s+|on\s+|about\s+)?\$?([a-z][a-z0-9]{1,11})\b/,
  );
  if (m) return normalizeToken(m[1]);
  // bare token word/symbol on its own.
  const bare = t.replace(/[^a-z0-9$]/g, "").replace(/^\$/, "");
  if (TOKEN_ALIASES[bare]) return TOKEN_ALIASES[bare];
  return null;
}

export function parseIntentLocallyForDemo(text: string): ParsedIntent {
  const cleaned = text.trim().replace(/\s+/g, " ");
  const send = cleaned.match(/^s(?:end|nd)\s+([0-9]+(?:\.[0-9]+)?)\s*([a-z0-9$]+)?\s+(?:to|2)\s+(.+)$/i);
  if (send) {
    return {
      outcome: "actions",
      actions: [
        {
          kind: "transfer",
          asset: (send[2] ?? "sol").replace(/^\$/, "").toUpperCase(),
          amountHuman: send[1],
          recipient: send[3].trim(),
        },
      ],
    };
  }

  const swap = cleaned.match(/^swap\s+([0-9]+(?:\.[0-9]+)?)\s+([a-z0-9$]+)\s+(?:for|into|to)\s+([a-z0-9$]+)/i);
  if (swap) {
    return {
      outcome: "actions",
      actions: [
        {
          kind: "swap_stub",
          amountHuman: swap[1],
          assetIn: swap[2],
          assetOut: swap[3],
        },
      ],
    };
  }

  const researchToken = matchResearch(cleaned);
  if (researchToken) {
    return { outcome: "actions", actions: [{ kind: "research", token: researchToken }] };
  }

  return {
    outcome: "clarify",
    question: "Do you want to send SOL, research a token, or preview a swap stub?",
  };
}

function normalizeIntent(input: unknown): ParsedIntent {
  if (!input || typeof input !== "object") {
    throw new PraxisInputError("intent output must be an object");
  }

  const value = input as Record<string, unknown>;
  const outcome = value.outcome;

  if (outcome === "clarify") {
    return {
      outcome,
      question: readRequiredString(value.question, "question"),
      options: readOptionalStrings(value.options),
    };
  }

  if (outcome === "unsupported") {
    return {
      outcome,
      message: readRequiredString(value.message, "message"),
    };
  }

  if (outcome !== "actions") throw new PraxisInputError(`unknown intent outcome "${String(outcome)}"`);

  const actions = Array.isArray(value.actions) ? value.actions : [];
  if (actions.length === 0) {
    throw new PraxisInputError("actions outcome requires at least one action");
  }

  return {
    outcome,
    actions: actions.map((action, index) => normalizeAction(action, index)),
  };
}

function normalizeAction(input: unknown, index: number): ParsedAction {
  if (!input || typeof input !== "object") {
    throw new PraxisInputError(`action ${index} must be an object`);
  }
  const value = input as Record<string, unknown>;

  if (value.kind === "transfer") {
    const asset = typeof value.asset === "string" && value.asset.trim()
      ? value.asset.trim().replace(/^\$/, "").toUpperCase()
      : "SOL";
    return {
      kind: "transfer",
      asset,
      amountHuman: readRequiredString(value.amountHuman, "amountHuman"),
      recipient: readRequiredString(value.recipient, "recipient"),
    };
  }

  if (value.kind === "research") {
    return {
      kind: "research",
      token: readRequiredString(value.token, "token"),
    };
  }

  if (value.kind === "swap_stub") {
    return {
      kind: "swap_stub",
      amountHuman: readRequiredString(value.amountHuman, "amountHuman"),
      assetIn: readRequiredString(value.assetIn, "assetIn").toUpperCase(),
      assetOut: readRequiredString(value.assetOut, "assetOut").toUpperCase(),
    };
  }

  throw new PraxisInputError(`unsupported action kind "${String(value.kind)}"`);
}

function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PraxisInputError(`intent field ${name} must be a non-empty string`);
  }
  return value.trim();
}

function readOptionalStrings(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}
