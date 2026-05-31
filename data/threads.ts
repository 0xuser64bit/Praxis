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
      { label: "Send to savings", active: true },
      { label: "Swap preview" },
      { label: "Bonk check-in" },
    ],
  },
  {
    label: "Yesterday",
    items: [
      { label: "USDC transfer" },
      { label: "Stake check" },
      { label: "Policy review" },
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
