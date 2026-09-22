import { PraxisInputError } from "../errors";
import { logger } from "../observability/logger";
import type { DcaCadence } from "../stocks/schedules";
import type { ParsedAction, ParsedIntent } from "./intent";

/**
 * How many actions one message may decompose into.
 *
 * Every action costs simulations and RPC round-trips, and a proposal card the
 * owner has to read. A model that returns fifty of them — because the input
 * asked it to, because it looped, or because the input was crafted to make it
 * loop — is not a request anyone typed; treating it as one turns a single
 * message into an unbounded amount of work. Real multi-step phrasing ("send X
 * to ADDR and save it as LABEL") is two.
 */
const MAX_ACTIONS_PER_MESSAGE = 5;

/** Long enough for any ticker, label, address or amount; short enough to log. */
const MAX_FIELD_LENGTH = 256;
/** Clarify questions and unsupported notes are prose, and still bounded. */
const MAX_PROSE_LENGTH = 2_000;
const MAX_CLARIFY_OPTIONS = 8;

export function normalizeIntent(input: unknown): ParsedIntent {
  if (!input || typeof input !== "object") {
    throw new PraxisInputError("intent output must be an object");
  }

  const value = input as Record<string, unknown>;
  const outcome = value.outcome;

  if (outcome === "clarify") {
    return {
      outcome,
      question: readRequiredString(value.question, "question", MAX_PROSE_LENGTH),
      options: readOptionalStrings(value.options),
    };
  }

  if (outcome === "unsupported") {
    return {
      outcome,
      message: readRequiredString(value.message, "message", MAX_PROSE_LENGTH),
    };
  }

  if (outcome !== "actions") throw new PraxisInputError(`unknown intent outcome "${String(outcome)}"`);

  const actions = Array.isArray(value.actions) ? value.actions : [];
  if (actions.length === 0) {
    throw new PraxisInputError("actions outcome requires at least one action");
  }
  if (actions.length > MAX_ACTIONS_PER_MESSAGE) {
    logger.warn("intent.too_many_actions", { actions: actions.length });
    return {
      outcome: "clarify",
      question:
        `That came back as ${actions.length} separate actions, which is more than I will do from `
        + "one message. Tell me the one you want first and we will work through them.",
    };
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
    const amountHuman = readRequiredString(value.amountHuman, "amountHuman");
    const usd = value.usdSigil === true ? ({ usdSigil: true } as const) : {};
    // `toSelf` has to be said, not inferred from a missing recipient: a model
    // that simply drops the field on "send 5 SOL to alex" must still land in
    // the clarify path, which is what readRequiredString does below.
    if (value.toSelf === true) {
      return { kind: "transfer", asset, amountHuman, toSelf: true, ...usd };
    }
    return {
      kind: "transfer",
      asset,
      amountHuman,
      recipient: readRequiredString(value.recipient, "recipient"),
      ...usd,
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

  if (value.kind === "schedule_dca") {
    const recipient = value.recipient === undefined || value.recipient === null
      ? undefined
      : readRequiredString(value.recipient, "recipient");
    return {
      kind: "schedule_dca",
      asset: readRequiredString(value.asset, "asset").replace(/^\$/, "").toUpperCase(),
      amountHuman: readRequiredString(value.amountHuman, "amountHuman"),
      recipient,
      cadence: readCadence(value.cadence),
    };
  }

  if (value.kind === "basket_buy") {
    const recipient = value.recipient === undefined || value.recipient === null
      ? undefined
      : readRequiredString(value.recipient, "recipient");
    return {
      kind: "basket_buy",
      basket: readRequiredString(value.basket, "basket"),
      amountHuman: readRequiredString(value.amountHuman, "amountHuman"),
      recipient,
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

function readCadence(value: unknown): DcaCadence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PraxisInputError("schedule_dca requires a cadence object");
  }
  const cadence = value as Record<string, unknown>;
  if (cadence.type === "daily") return { type: "daily" };
  if (cadence.type === "weekly") {
    const weekday = cadence.weekday === undefined ? new Date().getUTCDay() : cadence.weekday;
    if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new PraxisInputError("schedule_dca weekly cadence needs weekday 0-6");
    }
    return { type: "weekly", weekday };
  }
  if (cadence.type === "monthly") {
    const day = cadence.day === undefined ? new Date().getUTCDate() : cadence.day;
    if (typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > 31) {
      throw new PraxisInputError("schedule_dca monthly cadence needs day 1-31");
    }
    return { type: "monthly", day };
  }
  throw new PraxisInputError("schedule_dca cadence type must be daily, weekly, or monthly");
}

/**
 * `field` rides along in `details` so the reply can name what is missing.
 * "intent field recipient must be a non-empty string" is a sentence for a
 * log; "Who should receive it?" is one for the person who typed the line.
 */
function readRequiredString(
  value: unknown,
  name: string,
  maxLength = MAX_FIELD_LENGTH,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PraxisInputError(`intent field ${name} must be a non-empty string`, { field: name });
  }
  const trimmed = value.trim();
  // Model output is untrusted input like any other. A field longer than this
  // is not a recipient or a ticker, and letting it through only decides how
  // far downstream it fails.
  if (trimmed.length > maxLength) {
    throw new PraxisInputError(
      `intent field ${name} must be ${maxLength} characters or fewer`,
      { field: name },
    );
  }
  return trimmed;
}

function readOptionalStrings(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .slice(0, MAX_CLARIFY_OPTIONS)
    .map((item) => item.trim().slice(0, MAX_FIELD_LENGTH));
}
