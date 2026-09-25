import {
  IconCalendarRepeat,
  IconChartLine,
  IconCoins,
  IconHistory,
  IconMessage2,
  IconPackage,
  IconShieldLock,
  IconTerminal2,
  IconWallet,
  type Icon,
} from "@tabler/icons-react";

export type Capability = {
  icon: Icon;
  title: string;
  description: string;
  tag?: string;
};

/**
 * What is actually built, described as built.
 *
 * The previous list was written before most of it shipped and never caught
 * up: scheduled actions were tagged "Q2 2026" months after the scheduler was
 * running, a command palette was promised for "Q3 2026" and has never been
 * started, and cross-chain sat here as a card despite being explicitly out of
 * scope. Nothing on this page should be a roadmap item — that is what the
 * "What's next" section is for.
 */
export const CAPABILITIES: Capability[] = [
  {
    icon: IconShieldLock,
    title: "The Aegis envelope",
    description:
      "An Anchor program that checks signer, pause, expiry, per-transaction cap, rolling daily cap, recipient allow-list and configured mint — inside the instruction, before any value moves.",
    tag: "T1–T10 enforcement gate",
  },
  {
    icon: IconMessage2,
    title: "Intent parsing",
    description:
      "Plain language into a typed action, with misspellings, shorthand and multi-step requests. Two Tos in your contacts, or an amount it can't pin down, produces a question — never a guess.",
  },
  {
    icon: IconChartLine,
    title: "Simulation-first proposals",
    description:
      "Every action is simulated against live chain state before you see it. The card carries the fee, the simulation result and the Aegis verdict, so you sign something the chain has already agreed to.",
  },
  {
    icon: IconCoins,
    title: "SOL, SPL and Token-2022",
    description:
      "Native transfers go through agent_transfer; tokens through agent_transfer_spl, which CPIs TransferChecked so the token program re-verifies mint and decimals. One token envelope at a time, with its own caps.",
  },
  {
    icon: IconPackage,
    title: "Pre-IPO stocks",
    description:
      "Tokenized pre-IPO equity through PreStocks, priced from the live API. Baskets split a USD total across constituents and are all-or-nothing: one blocked leg clarifies the whole basket rather than part-filling it.",
    tag: "Mirror mints on devnet",
  },
  {
    icon: IconCalendarRepeat,
    title: "Recurring buys",
    description:
      "Daily, weekly or monthly schedules fired by a cron job across every wallet with one due. Each fire emits a proposal through the same checks and waits for a signature — auto-signing is out by design.",
  },
  {
    icon: IconWallet,
    title: "Owner actions stay yours",
    description:
      "Funding, withdrawal, caps, allow-lists, key rotation, revoke and teardown are wallet-signed by the owner. The backend can hold a scoped agent key; it never holds yours.",
  },
  {
    icon: IconHistory,
    title: "An audit trail on-chain",
    description:
      "Allowed actions land in the program's own ActionLog, so the record is the chain's rather than ours. Refusals are surfaced with the typed on-chain reason code that produced them.",
    tag: "16-entry ring buffer",
  },
  {
    icon: IconTerminal2,
    title: "A typed SDK",
    description:
      "@usepraxis/sdk signs the wallet-ownership challenge, holds the session and drives the agent from Node. It never sees a model key or the agent's private key — those stay server-side behind Aegis.",
  },
];
