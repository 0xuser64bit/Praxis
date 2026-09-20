import {
  IconCalendarRepeat,
  IconChartLine,
  IconPackage,
  IconRefresh,
  IconSend,
  IconShieldCog,
  type Icon,
} from "@tabler/icons-react";

export type UseCase = {
  icon: Icon;
  prompt: string;
  /** Split so the accent half can render inside <em>. */
  title: { lead: string; accent: string };
  description: string;
  tag?: string;
};

/**
 * Every prompt here parses in `server/agent/intent.ts`. That is a hard rule:
 * this list previously advertised DCA and bridging as "not in v0.1" months
 * after the scheduler shipped, and offered research as a 2026 roadmap item
 * while it was already answering. A prompt on the marketing page that the
 * parser refuses is worse than one that is missing.
 */
export const USE_CASES: UseCase[] = [
  {
    icon: IconSend,
    prompt: "send 0.5 sol to maya",
    title: { lead: "Send to ", accent: "a name." },
    description:
      "Addresses resolve through an address book you build by saving them in chat. Two contacts with the same name is a question, not a coin flip.",
  },
  {
    icon: IconPackage,
    prompt: "buy $40 openai for maya",
    title: { lead: "Buy ", accent: "pre-IPO." },
    description:
      "Tokenized pre-IPO equity, priced live from PreStocks. The mints are Token-2022, so Aegis moves them with TransferChecked under a token envelope separate from your SOL one.",
  },
  {
    icon: IconCalendarRepeat,
    prompt: "buy $50 spacex every monday",
    title: { lead: "Buy on a ", accent: "schedule." },
    description:
      "A cron job fires the schedule and emits a proposal through the same policy checks. It never signs for you — a recurring buy you have to approve is the only kind we will ship.",
  },
  {
    icon: IconChartLine,
    prompt: "what's openai doing this week",
    title: { lead: "Research, ", accent: "not advice." },
    description:
      "Price, 24h move, volume and liquidity from the live sources, plus what the token's issuer can still do to it. No buy, sell or hold calls — ever.",
  },
  {
    icon: IconShieldCog,
    prompt: "lower my daily cap to 2 sol",
    title: { lead: "Change the ", accent: "rules." },
    description:
      "The agent can draft a policy change; only your wallet can apply one. Aegis takes the owner's signature for every cap, allow-list and expiry on the account.",
  },
  {
    icon: IconRefresh,
    prompt: "swap 100 usdc into jup",
    title: { lead: "Blocked ", accent: "on purpose." },
    description:
      "Swaps are parsed, priced and previewed — then refused, because there is no Jupiter CPI and no way for the program to bound a route it never sees. We would rather show you the wall than route around it.",
    tag: "— previewed, never signed",
  },
];
