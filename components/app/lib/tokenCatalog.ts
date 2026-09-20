export const KNOWN_PROGRAMS = {
  system: "11111111111111111111111111111111",
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  jupiter: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
} as const;

export const KNOWN_MINTS = {
  wsol: "So11111111111111111111111111111111111111112",
  usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  jup: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  bonk: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
} as const;

const PROGRAM_NAMES: Record<string, string> = {
  [KNOWN_PROGRAMS.system]: "System Program",
  [KNOWN_PROGRAMS.tokenProgram]: "SPL Token",
  [KNOWN_PROGRAMS.jupiter]: "Jupiter Aggregator",
};

const MINT_NAMES: Record<string, string> = {
  [KNOWN_MINTS.wsol]: "SOL",
  [KNOWN_MINTS.usdc]: "USDC",
  [KNOWN_MINTS.jup]: "JUP",
  [KNOWN_MINTS.bonk]: "BONK",
};

const MINT_DECIMALS: Record<string, number> = {
  [KNOWN_MINTS.wsol]: 9,
  [KNOWN_MINTS.usdc]: 6,
  [KNOWN_MINTS.jup]: 6,
  [KNOWN_MINTS.bonk]: 5,
};

export function programLabel(address: string): string | null {
  return PROGRAM_NAMES[address] ?? null;
}

export function mintLabel(address: string): string | null {
  return MINT_NAMES[address] ?? null;
}

/**
 * Decimals for a mint this client knows statically.
 *
 * Returns `undefined` for anything else rather than guessing. This used to
 * fall back to 6, which silently mis-scaled every PreStocks mint (they are
 * 9dp) — the token-envelope cap defaults and displayed balances were off by
 * 1000x. Callers that have a live universe entry should prefer its decimals;
 * see `stockDecimalsFor` in the active-stock context.
 */
export function mintDecimals(address: string): number | undefined {
  return MINT_DECIMALS[address];
}

/**
 * Mock-mode fallbacks only. These are MAINNET addresses.
 *
 * They used to drive the live pickers, which is how a devnet deployment came
 * to offer USDC / JUP / BONK and answer "this mint is owned by 1111…1111"
 * after a wallet signature. Which mints exist is a fact about a cluster, so in
 * API mode both lists come from `/api/praxis/get-token-catalog`; see
 * `components/app/TokenCatalog.tsx`. Mock mode has no cluster — its provider
 * is the chain — so it still uses these.
 */
export const QUICK_MINTS = [
  { label: "USDC", address: KNOWN_MINTS.usdc },
  { label: "JUP", address: KNOWN_MINTS.jup },
  { label: "BONK", address: KNOWN_MINTS.bonk },
  { label: "SOL", address: KNOWN_MINTS.wsol },
];

export const TOKEN_ENVELOPE_MINTS = [
  { label: "USDC", address: KNOWN_MINTS.usdc },
  { label: "JUP", address: KNOWN_MINTS.jup },
  { label: "BONK", address: KNOWN_MINTS.bonk },
];
