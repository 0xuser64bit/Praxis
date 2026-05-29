/**
 * Rule-based intent parser — the mock agent's "brain". Deterministic so the
 * demo is reproducible by typing. Turns a natural-language line into agent
 * blocks plus any proposals/activity to commit. Ambiguous or unknown names ask
 * a clarifying question rather than guess (spec §12.ii).
 *
 * A real backend swaps this for a Claude tool-call that emits the same shapes.
 */

import type {
  ActionProposal,
  ActivityEntry,
  AddressBookEntry,
  AgentBlock,
  ClarifyOption,
  PolicyCheckResult,
  ResearchData,
  TokenInfo,
} from "@praxis/shared";
import { remaining } from "@praxis/shared";

import { formatUsd, shortenAddress, toBaseUnits } from "../lib/units";
import { effectiveSpentToday, checkTransfer } from "./policy";
import { ADDR, MINT, SOL_DECIMALS, type StoreState } from "./seed";

export interface ParseResult {
  blocks: AgentBlock[];
  /** Proposals to insert into the store. */
  proposals: ActionProposal[];
  /** Activity rows to prepend (rejections are logged the moment they happen). */
  activity: ActivityEntry[];
  /** Thread-title hint when this is the thread's first actionable line. */
  title?: string;
}

export interface ParseCtx {
  state: StoreState;
  now: number;
  genId: (prefix: string) => string;
}

const SEND_RE = /^send\s+([0-9]+(?:\.[0-9]+)?)\s*(sol|usdc)?\s+to\s+(.+)$/i;
const SWAP_RE =
  /^swap\s+([0-9]+(?:\.[0-9]+)?)\s*([a-z0-9$]+)\s+(?:for|into|to)\s+(\S+)/i;

const KNOWN_SYMBOLS = ["sol", "usdc", "jup", "bonk"];

export function parse(text: string, ctx: ParseCtx): ParseResult {
  const raw = text.trim().replace(/\s+/g, " ");
  const lower = raw.toLowerCase();

  if (!raw) return prose("Type something like “send 0.5 sol to maya”.");

  // --- revoke / kill switch (owner action; point them at the dashboard) ---
  if (/\b(revoke|kill ?switch|kill the agent|disable the agent|pause the agent)\b/.test(lower)) {
    return prose(
      "Revoking is an owner-only action, so I can't do it to myself — that's the point. " +
        "Open the **Policy** dashboard and hit **Revoke agent**: it zeroes my session key " +
        "on-chain in a single transaction, and my very next action fails. You're never not in control.",
    );
  }

  // --- send (native SOL transfer through agent_transfer) ---
  const send = raw.match(SEND_RE);
  if (send) return parseSend(send, ctx);
  if (/^send\b/.test(lower)) {
    return prose("Try a full instruction like “send 0.5 sol to maya”.");
  }

  // --- swap (agent-layer preview; agent_swap is v2) ---
  const swap = raw.match(SWAP_RE);
  if (swap) return parseSwap(swap, ctx);
  if (/^swap\b/.test(lower)) {
    return prose("Try “swap 100 usdc for jup”.");
  }

  // --- research (read-only) ---
  if (looksLikeResearch(lower)) return parseResearch(lower);

  // --- greeting / help ---
  if (/^(hi|hey|hello|help|what can you do|gm)\b/.test(lower)) {
    return prose(
      "I can **send SOL** to saved names, **propose swaps** through Jupiter, and pull " +
        "**read-only research** on a token. Every send is checked against your Aegis policy " +
        "before you sign. Try one of the suggestions below.",
    );
  }

  return prose(
    "I didn't catch an action there. I can send SOL, propose a swap, or research a token — " +
      "for example “send 0.5 sol to maya”, “swap 100 usdc for jup”, or “what's bonk doing this week”.",
  );
}

// ---------------------------------------------------------------------------

function parseSend(m: RegExpMatchArray, ctx: ParseCtx): ParseResult {
  const amountStr = m[1];
  const unit = (m[2] ?? "sol").toLowerCase();
  const namePart = m[3].trim().toLowerCase().replace(/[.?!]+$/, "");
  const { state, now } = ctx;

  if (unit === "usdc") {
    return prose(
      "Token (SPL) transfers are a v2 instruction. The transfer Aegis enforces today moves " +
        "**native SOL** — try “send 0.5 sol to maya”.",
    );
  }

  const matches = resolveContacts(namePart, state.addressBook);

  if (matches.length === 0) {
    return clarify(
      `I don't have anyone saved as “${m[3].trim()}”. Who did you mean?`,
      uniqueContacts(state.addressBook).map((e) => ({
        label: e.name,
        hint: shortenAddress(e.address),
        value: `send ${amountStr} sol to ${e.name.toLowerCase()}`,
      })),
    );
  }

  if (matches.length > 1) {
    return clarify(
      `I have more than one “${m[3].trim()}”. Which one?`,
      matches.map((e) => ({
        label: e.name,
        hint: `${shortenAddress(e.address)}${e.note ? ` · ${e.note}` : ""}`,
        value: `send ${amountStr} sol to ${e.name.toLowerCase()}`,
      })),
    );
  }

  const contact = matches[0];
  const amount = parseHumanAmount(amountStr, SOL_DECIMALS);
  if (amount === null) {
    return prose("That SOL amount has too many decimal places. Use lamport precision or round the amount.");
  }
  const check = checkTransfer(state.policy, amount, contact.address, now);
  const sol = state.tokens[0];

  const proposal: ActionProposal = {
    id: ctx.genId("p"),
    detail: {
      kind: "transfer",
      amount,
      asset: sol,
      recipientName: contact.name,
      recipientAddress: contact.address,
      recipientNote: contact.note,
    },
    networkFee: 5000n,
    simulation: check.allowed ? "Will succeed" : "Would be rejected on-chain",
    check,
    state: check.allowed ? "pending" : "blocked",
    sig: check.allowed ? undefined : failedSig(ctx),
  };

  const blocks: AgentBlock[] = [
    {
      type: "proposal",
      text: `Found **${contact.name}**${contact.note ? ` · ${contact.note}` : ""}.`,
      proposalId: proposal.id,
    },
  ];

  const activity: ActivityEntry[] = check.allowed
    ? []
    : [
        {
          id: ctx.genId("a"),
          kind: "transfer",
          label: contact.name,
          asset: "SOL",
          amount,
          decimals: SOL_DECIMALS,
          result: "rejected",
          reason: check.reason,
          reasonCode: check.reasonCode,
          ts: now,
          sig: proposal.sig,
        },
      ];

  return {
    blocks,
    proposals: [proposal],
    activity,
    title: `Send to ${contact.name.split(" ")[0]}`,
  };
}

// ---------------------------------------------------------------------------

function parseSwap(m: RegExpMatchArray, ctx: ParseCtx): ParseResult {
  const amountStr = m[1];
  const fromSym = m[2].replace(/^\$/, "").toUpperCase();
  const toRaw = m[3].replace(/^\$/, "");
  const { state, now } = ctx;

  const assetIn = findToken(state.tokens, fromSym);
  if (!assetIn) {
    return prose(`I don't recognize the input token “${fromSym}”. In this demo I know SOL, USDC, JUP, and BONK.`);
  }

  const assetOut = resolveOutToken(state.tokens, toRaw);
  const amountIn = parseHumanAmount(amountStr, assetIn.decimals);
  if (amountIn === null) {
    return prose(`${assetIn.symbol} supports ${assetIn.decimals} decimal places. Round the amount and try again.`);
  }
  const estAmountOut = estimateOut(amountIn, assetIn, assetOut);

  const check = checkSwapPolicy(state, assetOut, now);

  const proposal: ActionProposal = {
    id: ctx.genId("p"),
    detail: {
      kind: "swap",
      amountIn,
      assetIn,
      estAmountOut,
      assetOut,
      route: `${assetIn.symbol} › Jupiter › ${assetOut.symbol}`,
      priceImpactBps: 18,
    },
    networkFee: 5000n,
    simulation: check.allowed ? "Will succeed" : "Would be rejected by policy",
    check,
    state: check.allowed ? "pending" : "blocked",
    sig: check.allowed ? undefined : failedSig(ctx),
  };

  const blocks: AgentBlock[] = [
    {
      type: "proposal",
      text: check.allowed
        ? `Best route found via Jupiter. ${formatUsd(amountIn, assetIn.decimals, assetIn.symbol)} in.`
        : `I found a route, but your policy blocks it.`,
      proposalId: proposal.id,
    },
  ];

  const activity: ActivityEntry[] = check.allowed
    ? []
    : [
        {
          id: ctx.genId("a"),
          kind: "swap",
          label: `${assetIn.symbol} → ${assetOut.symbol}`,
          asset: assetIn.symbol,
          amount: amountIn,
          decimals: assetIn.decimals,
          result: "rejected",
          reason: check.reason,
          ts: now,
          sig: proposal.sig,
        },
      ];

  return {
    blocks,
    proposals: [proposal],
    activity,
    title: `Swap ${assetIn.symbol} → ${assetOut.symbol}`,
  };
}

// ---------------------------------------------------------------------------

function parseResearch(lower: string): ParseResult {
  const sym = KNOWN_SYMBOLS.find((s) => new RegExp(`\\b${s}\\b`).test(lower));
  if (!sym) {
    return prose("I can pull read-only on-chain data for SOL, USDC, JUP, or BONK in this demo. Which one?");
  }
  const data = RESEARCH[sym.toUpperCase()];
  return {
    blocks: [
      {
        type: "research",
        text: `Here's the on-chain picture for **${data.token}** over the last 7 days. Data only — I don't make buy, sell, or hold calls.`,
        data,
      },
    ],
    proposals: [],
    activity: [],
    title: `${data.token} research`,
  };
}

// ---------------------------------------------------------------------------
// helpers

function prose(text: string): ParseResult {
  return { blocks: [{ type: "prose", text }], proposals: [], activity: [] };
}

function clarify(text: string, options: ClarifyOption[]): ParseResult {
  return { blocks: [{ type: "clarify", text, options }], proposals: [], activity: [] };
}

function resolveContacts(name: string, book: AddressBookEntry[]): AddressBookEntry[] {
  const n = name.trim();
  // exact full-name match wins (used by clarify follow-ups)
  const exactName = book.filter((e) => e.name.toLowerCase() === n);
  if (exactName.length === 1) return exactName;
  // otherwise match on alias label or a leading name fragment
  return book.filter(
    (e) => e.label === n || e.name.toLowerCase() === n || e.name.toLowerCase().startsWith(`${n} `),
  );
}

function uniqueContacts(book: AddressBookEntry[]): AddressBookEntry[] {
  const seen = new Set<string>();
  return book.filter((e) => (seen.has(e.address) ? false : (seen.add(e.address), true)));
}

function findToken(tokens: TokenInfo[], symbol: string): TokenInfo | undefined {
  return tokens.find((t) => t.symbol === symbol.toUpperCase());
}

function parseHumanAmount(human: string, decimals: number): bigint | null {
  try {
    return toBaseUnits(human, decimals);
  } catch {
    return null;
  }
}

function resolveOutToken(tokens: TokenInfo[], raw: string): TokenInfo {
  const known = findToken(tokens, raw);
  if (known) return known;
  // an unverified token: a raw mint address or an unknown symbol
  const looksLikeAddress = raw.length >= 32 && !raw.includes(".");
  return {
    symbol: looksLikeAddress ? "UNVERIFIED" : raw.toUpperCase(),
    mint: looksLikeAddress ? raw : `Unv${raw.replace(/[^a-z0-9]/gi, "")}11111111111111111111111111`,
    decimals: 6,
    verified: false,
  };
}

function estimateOut(amountIn: bigint, assetIn: TokenInfo, assetOut: TokenInfo): bigint {
  // Quote estimate only, but still integer math: USD nano-prices are rationals.
  const rateIn = priceNanos(assetIn.symbol);
  const rateOut = priceNanos(assetOut.symbol);
  if (!rateIn || !rateOut) return rescaleBaseUnits(amountIn, assetIn.decimals, assetOut.decimals);
  return (
    (amountIn * rateIn * 10n ** BigInt(assetOut.decimals)) /
    (10n ** BigInt(assetIn.decimals) * rateOut)
  );
}

function priceNanos(symbol: string): bigint | undefined {
  const rates: Record<string, bigint> = {
    SOL: 186_420_000_000n,
    USDC: 1_000_000_000n,
    JUP: 1_140_000_000n,
    BONK: 27_300n,
  };
  return rates[symbol];
}

function rescaleBaseUnits(amount: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (toDecimals === fromDecimals) return amount;
  if (toDecimals > fromDecimals) return amount * 10n ** BigInt(toDecimals - fromDecimals);
  return amount / 10n ** BigInt(fromDecimals - toDecimals);
}

export function checkSwapPolicy(
  state: StoreState,
  assetOut: TokenInfo,
  now: number,
): PolicyCheckResult {
  const spentToday = effectiveSpentToday(state.policy, now);
  const dailyLimit = state.policy.dailyLimit;
  const remainingToday = remaining(dailyLimit, spentToday);

  if (state.policy.paused) {
    return {
      allowed: false,
      reason:
        "Aegis is paused — the agent session key has been revoked. Re-enable it from the Policy dashboard to route swaps again.",
      spentToday,
      dailyLimit,
      remaining: remainingToday,
    };
  }

  if (!state.policy.allowedPrograms.includes(ADDR.jupiter)) {
    return {
      allowed: false,
      reason:
        "Jupiter is not in your allowed-program list, so Aegis will not let the agent route this swap.",
      spentToday,
      dailyLimit,
      remaining: remainingToday,
    };
  }

  if (!state.policy.allowedMints.includes(assetOut.mint)) {
    return {
      allowed: false,
      // agent-layer verdict — no on-chain RejectReason (agent_swap is v2)
      reason: `${assetOut.symbol} (${shortenAddress(assetOut.mint)}) isn't in your verified-mint allow-list, so Aegis won't let the agent route into it. Add the mint in the Policy dashboard if you trust it.`,
      spentToday,
      dailyLimit,
      remaining: remainingToday,
    };
  }

  return {
    allowed: true,
    spentToday,
    dailyLimit,
    remaining: remainingToday,
  };
}

function failedSig(ctx: ParseCtx): string {
  return `Fai1ed${ctx.genId("s").replace(/[^a-z0-9]/gi, "")}xRejectedByAegisPolicy11`;
}

function looksLikeResearch(lower: string): boolean {
  const hasToken = KNOWN_SYMBOLS.some((s) => new RegExp(`\\b${s}\\b`).test(lower));
  const researchy =
    /\b(what'?s|what is|how('?s| is| are)|doing|happening|price|volume|holders|research|this week|going|look(s|ing)?)\b/.test(
      lower,
    );
  return (hasToken && researchy) || lower.startsWith("research ");
}

// Canned read-only data for the demo's research surface.
const RESEARCH: Record<string, ResearchData> = {
  BONK: {
    token: "BONK",
    mint: MINT.bonk,
    summary:
      "Price is up week-over-week on rising volume; holder count grew modestly. Liquidity is concentrated in the top two pools.",
    metrics: [
      { label: "Price", value: "$0.00002730", trend: "up" },
      { label: "7d change", value: "+18.4%", trend: "up" },
      { label: "24h volume", value: "$142.6M", trend: "up" },
      { label: "Holders", value: "742,910", trend: "up" },
      { label: "Market cap", value: "$1.93B", trend: "flat" },
    ],
  },
  JUP: {
    token: "JUP",
    mint: MINT.jup,
    summary:
      "Volume cooled from last week's highs; holders flat. Most liquidity sits in JUP/USDC and JUP/SOL pools.",
    metrics: [
      { label: "Price", value: "$1.14", trend: "down" },
      { label: "7d change", value: "−4.2%", trend: "down" },
      { label: "24h volume", value: "$88.1M", trend: "down" },
      { label: "Holders", value: "612,400", trend: "flat" },
      { label: "Market cap", value: "$1.55B", trend: "down" },
    ],
  },
  SOL: {
    token: "SOL",
    mint: MINT.wsol,
    summary:
      "Network activity steady; fees low and stable. Price firmed over the week alongside higher DEX volume.",
    metrics: [
      { label: "Price", value: "$186.42", trend: "up" },
      { label: "7d change", value: "+6.1%", trend: "up" },
      { label: "24h DEX volume", value: "$2.4B", trend: "up" },
      { label: "Avg fee", value: "$0.0001", trend: "flat" },
      { label: "TPS (real)", value: "1,180", trend: "flat" },
    ],
  },
  USDC: {
    token: "USDC",
    mint: MINT.usdc,
    summary: "Stable, as expected. Deep liquidity across every major pool; the agent's default settlement asset.",
    metrics: [
      { label: "Price", value: "$1.0000", trend: "flat" },
      { label: "7d change", value: "+0.0%", trend: "flat" },
      { label: "On-chain supply", value: "$8.9B", trend: "flat" },
      { label: "24h volume", value: "$3.1B", trend: "up" },
    ],
  },
};
