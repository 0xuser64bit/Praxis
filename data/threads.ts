export type ThreadItem = {
  label: string;
  active?: boolean;
};

export type ThreadGroup = {
  label: string;
  items: ThreadItem[];
};

export const THREAD_GROUPS: ThreadGroup[] = [
  {
    label: "Today",
    items: [
      { label: "Send to Maya", active: true },
      { label: "Swap to JUP" },
      { label: "Bonk check-in" },
    ],
  },
  {
    label: "Yesterday",
    items: [
      { label: "DCA setup · pending" },
      { label: "Stake check" },
      { label: "Bridge to Base" },
    ],
  },
  {
    label: "This week",
    items: [
      { label: "What's a Bonk?" },
      { label: "Wallet hygiene" },
      { label: "Slippage explainer" },
    ],
  },
];
