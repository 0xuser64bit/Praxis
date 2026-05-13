import {
  IconAddressBook,
  IconBuildingBridge,
  IconCalendarClock,
  IconChartLine,
  IconRefresh,
  IconSend,
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

export const USE_CASES: UseCase[] = [
  {
    icon: IconSend,
    prompt: "send 0.5 sol to maya for dinner",
    title: { lead: "Send to ", accent: "anyone." },
    description:
      "Aliases, .sol domains, or pasted addresses. Praxis remembers who you've transacted with and surfaces them by name.",
  },
  {
    icon: IconRefresh,
    prompt: "swap 100 usdc for jup at best rate",
    title: { lead: "Swap at the ", accent: "best route." },
    description:
      "Routed across Orca, Raydium, Meteora, and more via Jupiter. Verified tokens by default. Slippage and impact shown before you sign.",
  },
  {
    icon: IconChartLine,
    prompt: "what's bonk doing this week",
    title: { lead: "Research, ", accent: "distilled." },
    description:
      'On-chain volume, price action, holder concentration. No "ape now" calls — just the data you\'d dig for, summarized.',
    tag: "— Q2 2026",
  },
  {
    icon: IconBuildingBridge,
    prompt: "bridge 0.5 sol to base as eth",
    title: { lead: "Bridge ", accent: "across chains." },
    description:
      "deBridge and Wormhole under the hood. Routes compared, finality times shown, gas estimated on both sides.",
  },
  {
    icon: IconCalendarClock,
    prompt: "dca 100 usdc into sol weekly for 3 months",
    title: { lead: "Automate, ", accent: "within limits." },
    description:
      "Conditional, scheduled, or recurring actions. Always scoped — you grant exactly what the agent may do, nothing more.",
    tag: "— Q2 2026",
  },
  {
    icon: IconAddressBook,
    prompt: "save this address as tom",
    title: { lead: "A book of ", accent: "known people." },
    description:
      "Praxis builds an address book from your transaction history and explicit saves. Ambiguity always asks before acting.",
  },
];
