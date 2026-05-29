/** Friendly names for well-known programs/mints, for the allow-list UI. */

import { ADDR, MINT } from "./seed";

const PROGRAM_NAMES: Record<string, string> = {
  [ADDR.system]: "System Program",
  [ADDR.tokenProgram]: "SPL Token",
  [ADDR.jupiter]: "Jupiter Aggregator",
};

const MINT_NAMES: Record<string, string> = {
  [MINT.wsol]: "SOL",
  [MINT.usdc]: "USDC",
  [MINT.jup]: "JUP",
  [MINT.bonk]: "BONK",
};

export function programLabel(address: string): string | null {
  return PROGRAM_NAMES[address] ?? null;
}

export function mintLabel(address: string): string | null {
  return MINT_NAMES[address] ?? null;
}

/** Mints the user can quick-add (the verified universe), for the mint editor. */
export const QUICK_MINTS = [
  { label: "USDC", address: MINT.usdc },
  { label: "JUP", address: MINT.jup },
  { label: "BONK", address: MINT.bonk },
  { label: "SOL", address: MINT.wsol },
];
