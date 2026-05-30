import { PraxisConfigError, PraxisInputError } from "../errors";
import type { PraxisServerConfig } from "../env";

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

export async function parseIntentWithClaude(text: string, config: PraxisServerConfig): Promise<ParsedIntent> {
  if (!config.anthropicApiKey) {
    throw new PraxisConfigError("ANTHROPIC_API_KEY is required for intent parsing.");
  }
  if (!config.anthropicModel) {
    throw new PraxisConfigError("ANTHROPIC_MODEL is required for intent parsing.");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 700,
      temperature: 0,
      system: [
        "You parse user text for Praxis, a Solana agent protected by Aegis.",
        "Return exactly one tool call.",
        "Supported actions: native SOL transfer, read-only token research, and swap_stub.",
        "Swaps are not executable yet; emit swap_stub, never pretend agent_swap exists.",
        "Never emit buy/sell/hold advice. Research is neutral data only.",
        "Handle misspellings, shorthand, slang, and multiple steps in order.",
        "If the amount, recipient, asset, token, or action is ambiguous, outcome must be clarify.",
        "Never guess. One clarifying question is safer than one wrong transaction.",
      ].join(" "),
      tools: [intentTool],
      tool_choice: { type: "tool", name: INTENT_TOOL_NAME },
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic Messages API failed (${res.status}): ${body}`);
  }

  const body = await res.json();
  const toolUse = Array.isArray(body.content)
    ? body.content.find((part: { type?: string; name?: string }) => {
        return part.type === "tool_use" && part.name === INTENT_TOOL_NAME;
      })
    : undefined;

  if (!toolUse?.input) {
    throw new PraxisInputError("Claude did not return the expected intent tool output.");
  }

  return normalizeIntent(toolUse.input);
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

  const research = cleaned.match(/(?:what'?s|research|check)\s+([a-z0-9$]+)(?:\s|$)/i);
  if (research) {
    return { outcome: "actions", actions: [{ kind: "research", token: research[1] }] };
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
