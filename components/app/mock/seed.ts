/**
 * Seed state for the mock provider. A realistic envelope + history so the §9
 * demo is walkable standalone: a saved-name send, an over-cap rejection, an
 * unverified-mint swap rejection, the revoke kill-switch, and a read-only
 * research query all behave correctly against this seed.
 *
 * All money is base units (`bigint`). Nothing here is persisted — it is rebuilt
 * fresh on every page load (in-memory only, no browser storage).
 */

import type {
  ActionProposal,
  ActivityEntry,
  AddressBookEntry,
  Thread,
  TokenInfo,
} from "@praxis/shared";
import { RejectReason } from "@praxis/shared";
import type { PolicyView } from "@praxis/shared";

import { toBaseUnits } from "../lib/units";

// --- well-known addresses (mainnet program/mint ids are real; wallets are demo) ---
export const ADDR = {
  owner: "7xKpR9vN3sT5wY8dFgH6jL4zXcUmAbQeD7oVBgh2",
  agent: "AgSESknKey4PraxizDemoAgentAuthrztn9nbXyZ7q",
  policy: "PoLicE7Praxiz9Aegis2DemoPDAvw8sk3mTnqKqpZ4",
  vault: "VauLt7Praxiz9Aegis2DemoPDAxw9tk4nUmrKpqWz2",
  system: "11111111111111111111111111111111",
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  jupiter: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  maya: "9bLmF8r2VqN4tP6wXsD3kJhG7yReUaCozMv5nK3pQ",
  carlos: "Cz4rLoS8vK2nQ7wT9xR3mP6jH5gFdSaUbEoY1tBn8wd",
  treasury: "TrEZ9uRy4vK7nQ2wX8sP3mJ6hG5fDaSbUcEoY1tBnqp",
  alexKim: "A1exK1mZ8vR4nQ7wT2xS9mP6jH3gFdUbEoY5tBnKim7",
  alexStone: "A1exStnE5vK9nQ3wT7xR2mP8jHgFdUbEoY6tBnStne2",
} as const;

export const MINT = {
  wsol: "So11111111111111111111111111111111111111112",
  usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  jup: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  bonk: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
} as const;

export const SOL_DECIMALS = 9;

/** The agent's recognized tokens; `verified` mirrors the policy allow-list. */
export const TOKENS: TokenInfo[] = [
  { symbol: "SOL", mint: MINT.wsol, decimals: 9, verified: true },
  { symbol: "USDC", mint: MINT.usdc, decimals: 6, verified: true },
  { symbol: "JUP", mint: MINT.jup, decimals: 6, verified: true },
  { symbol: "BONK", mint: MINT.bonk, decimals: 5, verified: true },
];

/** Address book — note the two "alex" entries: resolving "alex" must ask. */
export const ADDRESS_BOOK: AddressBookEntry[] = [
  { label: "maya", name: "Maya Patel", address: ADDR.maya, note: "3 prior transactions · last 6 days ago" },
  { label: "carlos", name: "Carlos Rivera", address: ADDR.carlos, note: "1 prior transaction" },
  { label: "treasury", name: "Ops Treasury", address: ADDR.treasury, note: "shared treasury" },
  { label: "alex", name: "Alex Kim", address: ADDR.alexKim, note: "2 prior transactions" },
  { label: "alex", name: "Alex Stone", address: ADDR.alexStone, note: "new contact" },
];

export interface StoreState {
  threads: Thread[];
  proposals: Record<string, ActionProposal>;
  policy: PolicyView;
  activity: ActivityEntry[];
  addressBook: AddressBookEntry[];
  tokens: TokenInfo[];
  thinking: Record<string, boolean>;
}

const HOUR = 3600;
const DAY = 86_400;

export function createInitialState(): StoreState {
  const now = Math.floor(Date.now() / 1000);
  const sol = (h: string) => toBaseUnits(h, SOL_DECIMALS);

  const policy: PolicyView = {
    address: ADDR.policy,
    owner: ADDR.owner,
    agentAuthority: ADDR.agent,
    maxPerTx: sol("50"),
    dailyLimit: sol("5"),
    spentToday: 0n,
    dayStartTs: now,
    allowedPrograms: [ADDR.system, ADDR.tokenProgram, ADDR.jupiter],
    allowedRecipients: [], // empty = any recipient allowed
    allowedMints: [MINT.wsol, MINT.usdc, MINT.jup, MINT.bonk],
    expiryTs: now + 7 * DAY,
    paused: false,
    vaultBalance: sol("6.25"),
    // SPL-token envelope disabled by default (no token configured), mirroring a
    // fresh on-chain policy. The agent moves native SOL today; the dashboard's
    // token-transfer surface is a later wiring step.
    tokenMint: ADDR.system,
    tokenMaxPerTx: 0n,
    tokenDailyLimit: 0n,
    tokenSpentToday: 0n,
    tokenDayStartTs: now,
  };

  // A signed historical transfer from the previous window; the live demo starts
  // with zero spent today so the first 0.5 SOL send leaves 4.5 SOL.
  const pMaya: ActionProposal = {
    id: "p-seed-maya",
    detail: {
      kind: "transfer",
      amount: sol("0.5"),
      asset: TOKENS[0],
      recipientName: "Maya Patel",
      recipientAddress: ADDR.maya,
      recipientNote: "3 prior transactions",
    },
    networkFee: 5000n,
    simulation: "Confirmed",
    check: {
      allowed: true,
      spentToday: 0n,
      dailyLimit: sol("5"),
      remaining: sol("5"),
    },
    state: "signed",
    sig: "3vK2q9X9aF7m4Tn8sR2wYdH6jL4zXcUmAbQeD7oVnpx",
  };

  const threads: Thread[] = [
    {
      id: "t-welcome",
      title: "New session",
      updatedAt: now,
      messages: [
        {
          id: "m-welcome",
          role: "agent",
          ts: now,
          blocks: [
            {
              type: "prose",
              text:
                "I'm Praxis. Tell me what you want to do on Solana in plain language — " +
                "send, swap, or research. Every action I propose is checked against your " +
                "on-chain Aegis policy before you sign, and you can revoke me at any time " +
                "from the Policy dashboard.",
            },
          ],
        },
      ],
    },
    {
      id: "t-maya",
      title: "Send to Maya",
      updatedAt: now - 30 * HOUR,
      messages: [
        { id: "m-maya-1", role: "user", ts: now - 30 * HOUR, text: "send 0.5 sol to maya" },
        {
          id: "m-maya-2",
          role: "agent",
          ts: now - 30 * HOUR + 2,
          blocks: [
            {
              type: "proposal",
              text: "Found **Maya Patel** · 3 prior transactions, last 6 days ago.",
              proposalId: "p-seed-maya",
            },
          ],
        },
      ],
    },
    {
      id: "t-bonk",
      title: "Bonk check-in",
      updatedAt: now - 28 * HOUR,
      messages: [
        { id: "m-bonk-1", role: "user", ts: now - 28 * HOUR, text: "what's bonk doing this week" },
        {
          id: "m-bonk-2",
          role: "agent",
          ts: now - 28 * HOUR + 2,
          blocks: [
            {
              type: "research",
              text: "Here's the on-chain picture for **BONK** over the last 7 days. Data only — I don't make buy, sell, or hold calls.",
              data: {
                token: "BONK",
                mint: MINT.bonk,
                summary:
                  "Price is up week-over-week on rising volume; holder count grew modestly. " +
                  "Liquidity is concentrated in the top two pools.",
                metrics: [
                  { label: "Price", value: "$0.00002730", trend: "up" },
                  { label: "7d change", value: "+18.4%", trend: "up" },
                  { label: "24h volume", value: "$142.6M", trend: "up" },
                  { label: "Holders", value: "742,910", trend: "up" },
                  { label: "Market cap", value: "$1.93B", trend: "flat" },
                ],
              },
            },
          ],
        },
      ],
    },
  ];

  const activity: ActivityEntry[] = [
    {
      id: "a-seed-1",
      kind: "transfer",
      label: "Maya Patel",
      asset: "SOL",
      amount: sol("0.5"),
      decimals: SOL_DECIMALS,
      result: "allowed",
      ts: now - 30 * HOUR,
      sig: "3vK2q9X9aF7m4Tn8sR2wYdH6jL4zXcUmAbQeD7oVnpx",
    },
    {
      id: "a-seed-2",
      kind: "swap",
      label: "USDC → SOL",
      asset: "USDC",
      amount: toBaseUnits("50", 6),
      decimals: 6,
      result: "allowed",
      ts: now - 5 * HOUR,
      sig: "5wQ8rT2mP6jH9X4aF7nK3sR2wYdHzXcUmAbQeD7oVkz",
    },
    {
      id: "a-seed-3",
      kind: "transfer",
      label: "Cold storage",
      asset: "SOL",
      amount: sol("75"),
      decimals: SOL_DECIMALS,
      result: "rejected",
      reason: "75 SOL exceeds the 50 SOL per-transaction limit.",
      reasonCode: RejectReason.OverPerTx,
      ts: now - 2 * HOUR,
      sig: "9pX4aF7nK3sR2wYdHzXcUmAbQeD7oV5wQ8rT2mP6jHb",
    },
  ];

  return {
    threads,
    proposals: { [pMaya.id]: pMaya },
    policy,
    activity,
    addressBook: ADDRESS_BOOK,
    tokens: TOKENS,
    thinking: {},
  };
}
