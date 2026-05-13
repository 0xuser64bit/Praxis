import {
  IconBuildingBridge,
  IconCalendarClock,
  IconChartLine,
  IconCommand,
  IconHistory,
  IconKey,
  IconMessage2,
  IconRoute,
  IconShieldCheck,
  type Icon,
} from "@tabler/icons-react";

export type Capability = {
  icon: Icon;
  title: string;
  description: string;
  tag?: string;
};

export const CAPABILITIES: Capability[] = [
  {
    icon: IconMessage2,
    title: "Intent parsing",
    description:
      "Multi-turn conversation memory. Aliases, fuzzy token matching, multi-step actions chained in a single line.",
  },
  {
    icon: IconShieldCheck,
    title: "Simulation-first",
    description:
      "Every transaction simulated against live state. Slippage caps, fee bounds, and outcome previews — all enforced.",
  },
  {
    icon: IconRoute,
    title: "Best-route swaps",
    description:
      "Jupiter aggregator under the hood. Verified tokens by default. Unverified mints require explicit override.",
  },
  {
    icon: IconKey,
    title: "Non-custodial",
    description:
      "Connects to your existing Phantom or Solflare wallet. Praxis proposes and previews; only you can sign.",
  },
  {
    icon: IconHistory,
    title: "Address book",
    description:
      "Auto-suggested from your transaction history. Explicit saves. Ambiguity resolved through clarifying questions.",
    tag: "Ships v0.1",
  },
  {
    icon: IconChartLine,
    title: "Market research",
    description:
      "On-chain volume, price action, holder concentration, sentiment. Data surfaced — never financial advice.",
    tag: "Q2 2026",
  },
  {
    icon: IconCalendarClock,
    title: "Scoped automation",
    description:
      "Conditional and scheduled actions within session-key limits you set. DCA, rebalancing, conditional trades.",
    tag: "Q2 2026",
  },
  {
    icon: IconBuildingBridge,
    title: "Cross-chain",
    description:
      "Bridge to Base and Ethereum via deBridge and Wormhole. Routes compared, finality estimated.",
    tag: "Q3 2026",
  },
  {
    icon: IconCommand,
    title: "Power-user mode",
    description:
      "Keyboard-first interface. Command palette. Saved prompts. Custom slippage and gas defaults per asset.",
    tag: "Q3 2026",
  },
];
