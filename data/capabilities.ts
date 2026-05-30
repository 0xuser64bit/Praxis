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
    title: "Swap policy preview",
    description:
      "Swap intents are parsed and checked against verified-mint policy. Executable Jupiter routing is the next implementation phase.",
    tag: "Stub in v0.1",
  },
  {
    icon: IconKey,
    title: "Scoped custody model",
    description:
      "Aegis uses a program-owned vault and a revocable agent key for the demo. Owner-signed wallet admin is the production path.",
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
      "On-chain volume, price action, holder concentration, and liquidity context. Data surfaced — never financial advice.",
    tag: "Ships v0.1",
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
      "Future bridge work must stay owner-signed or gain a real far-side enforcement story. It is not part of the agent path today.",
    tag: "Later",
  },
  {
    icon: IconCommand,
    title: "Power-user mode",
    description:
      "Keyboard-first interface. Command palette. Saved prompts. Custom slippage and gas defaults per asset.",
    tag: "Q3 2026",
  },
];
