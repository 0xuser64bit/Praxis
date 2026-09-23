import { PublicKey } from "@solana/web3.js";

import { STOCK_SYMBOLS, normalizeStockAlias } from "../stocks/universe";
import { availableBaskets, parseCadence, resolveBasket } from "../stocks/schedules";
import type { ParsedAction, ParsedIntent } from "./intent";

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
      ...(hasUsdSigil(text) ? { usdSigil: true as const } : {}),
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
