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
              enum: ["transfer", "research", "swap_stub", "policy_question", "save_contact", "policy_change"],
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
  "Supported actions: native SOL transfer, read-only token research, swap_stub, policy_question, save_contact, and policy_change.",
  "Swaps are not executable yet; emit swap_stub, never pretend agent_swap exists.",
  "Never emit buy/sell/hold advice. Research is neutral data only.",
  "policy_question: when the user ASKS ABOUT their own policy, limits, caps, session expiry, pause state, allow-lists, or how Praxis keeps them safe. Pick the closest topic, or 'general'.",
  "policy_change: when the user wants to CHANGE a policy setting. 'change/raise/lower/set my daily limit to N SOL' -> field=daily_limit, amountHuman=N. 'set max per tx to N SOL' -> field=max_per_tx, amountHuman=N. 'extend my session by N hours/days' or 'set expiry to N hours' -> field=expiry, expiryHours=N (convert days to hours). 'pause/freeze the agent' -> field=pause, paused=true. 'unpause/resume the agent' -> field=pause, paused=false. Distinguish a CHANGE (imperative: change/set/raise/lower/pause) from a QUESTION (what/how/is my...).",
  "save_contact: when the user asks to save/remember an address under a name. Extract the base58 address and the label separately.",
  "Decompose multi-step requests in order. 'send X to ADDR and save as LABEL' is TWO actions: a transfer (recipient = ADDR) and a save_contact (address = ADDR, label = LABEL). Never fold 'and save as ...' into the recipient.",
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
    const asset = (send[2] ?? "sol").replace(/^\$/, "").toUpperCase();
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
      actions: [{ kind: "transfer", asset, amountHuman, recipient: send[3].trim() }],
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

  if (value.kind === "policy_question") {
    const allowed = ["caps", "expiry", "allowlist", "pause", "general"] as const;
    const topic = typeof value.topic === "string" && (allowed as readonly string[]).includes(value.topic)
      ? (value.topic as (typeof allowed)[number])
      : "general";
    return { kind: "policy_question", topic };
  }

  if (value.kind === "save_contact") {
    return {
      kind: "save_contact",
      label: readRequiredString(value.label, "label"),
      address: readRequiredString(value.address, "address"),
    };
  }

  if (value.kind === "policy_change") {
    const allowed = ["daily_limit", "max_per_tx", "expiry", "pause"] as const;
    const field = typeof value.field === "string" && (allowed as readonly string[]).includes(value.field)
      ? (value.field as (typeof allowed)[number])
      : undefined;
    if (!field) {
      throw new PraxisInputError("policy_change requires a field of daily_limit, max_per_tx, expiry, or pause");
    }
    if (field === "pause") {
      if (typeof value.paused !== "boolean") {
        throw new PraxisInputError("policy_change pause requires a boolean 'paused'");
      }
      return { kind: "policy_change", field, paused: value.paused };
    }
    if (field === "expiry") {
      const hours = typeof value.expiryHours === "number"
        ? value.expiryHours
        : Number(value.expiryHours);
      if (!Number.isFinite(hours) || hours <= 0) {
        throw new PraxisInputError("policy_change expiry requires a positive 'expiryHours'");
      }
      return { kind: "policy_change", field, expiryHours: hours };
    }
    return {
      kind: "policy_change",
      field,
      amountHuman: readRequiredString(value.amountHuman, "amountHuman"),
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
