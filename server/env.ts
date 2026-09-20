import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import bs58 from "bs58";
import { Keypair, PublicKey, type Commitment } from "@solana/web3.js";
import type { AddressBookEntry, TokenInfo } from "@praxis/shared";

import { DEFAULT_AEGIS_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "./aegis/constants";
import { findPolicyPda } from "./aegis/pdas";
import { PraxisConfigError } from "./errors";
import { STOCK_SYMBOLS, buildStockTokens } from "./stocks/universe";
import { primeMintDecimals } from "./stocks/mintDecimals";

const DEFAULT_CONTACTS: AddressBookEntry[] = [
  {
    label: "maya",
    name: "Maya Patel",
    address: "ALUMw7kSn9xn67suHr2ti21CXBQVNMuRk7uWSM1WuXEt",
    note: "saved contact",
  },
  {
    label: "carlos",
    name: "Carlos Rivera",
    address: "QFHwzufVzALBoVNrbX4CGd3auxHhyELDMb1M1JwBtXh",
    note: "saved contact",
  },
  {
    label: "treasury",
    name: "Ops Treasury",
    address: "8xdGRM1bAy4gFDQrdiFesF1FsuRYdecDYC3B5wofYi9t",
    note: "shared treasury",
  },
  {
    label: "alex",
    name: "Alex Kim",
    address: "HVzzeZJjKj7UMjP7PTirZum5ANg3NYHiQe31AJpKk7kY",
    note: "2 prior transactions",
  },
  {
    label: "alex",
    name: "Alex Stone",
    address: "Ef6t2L4oAnPoZahdLoKHYUZADDjEYBQiSuDkrjDfTc3X",
    note: "new contact",
  },
];

export const DEFAULT_TOKENS: TokenInfo[] = [
  {
    symbol: "SOL",
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
    verified: true,
  },
  {
    symbol: "USDC",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    verified: true,
  },
  {
    symbol: "JUP",
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    decimals: 6,
    verified: true,
  },
  {
    symbol: "BONK",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    decimals: 5,
    verified: true,
  },
];

export interface PraxisServerConfig {
  geminiApiKey?: string;
  geminiModel?: string;
  rpcUrl: string;
  /** Read-only RPC for token research. Tokens are mainnet mints, so this defaults
   *  to mainnet-beta even when transfers (rpcUrl) run on devnet. */
  researchRpcUrl: string;
  commitment: Commitment;
  programId: PublicKey;
  policyAddress?: PublicKey;
  ownerAddress?: PublicKey;
  agentKeypair?: Keypair;
  ownerKeypair?: Keypair;
  nextAgentKeypair?: Keypair;
  addressBook: AddressBookEntry[];
  tokens: TokenInfo[];
  indexerUrl?: string;
  /** Stocklana C02: PreStocks universe seam. Off by default — `main` behavior is
   *  unchanged unless `PRAXIS_STOCKS_ENABLED=1`. */
  stocksEnabled: boolean;
  prestocksApiUrl: string;
  prestocksTimeoutMs: number;
  /** `undefined` = full 8-symbol universe; otherwise a subset of known symbols. */
  stockUniverse: string[] | undefined;
  /**
   * Operator-confirmed decimals per stock symbol (`PRAXIS_STOCK_DECIMALS`).
   * The PreStocks API omits decimals; anything not listed here is resolved
   * from the chain before any amount math, never guessed.
   */
  stockDecimals: Record<string, number>;
  /**
   * Symbol → mint overrides (`PRAXIS_STOCK_MINTS`). Lets a devnet deployment
   * point the stock universe at mirror mints created on that cluster, since
   * the real PreStocks mints exist only on mainnet.
   */
  stockMints: Record<string, string>;
  /**
   * UTC hour the scheduled-buy job runs (`PRAXIS_SCHEDULE_HOUR_UTC`, default
   * 9), which must match the cron expression in `vercel.json`. Schedules are
   * anchored to it so a weekly buy fires on the weekday it promises.
   */
  scheduleHourUtc: number;
}

export const DEFAULT_PRESTOCKS_API_URL = "https://prestocks.com/api/prestocks";
export const DEFAULT_PRESTOCKS_TIMEOUT_MS = 5_000;

let cachedConfig: PraxisServerConfig | undefined;

export function resetConfigForTests() {
  cachedConfig = undefined;
}

export function getServerConfig(): PraxisServerConfig {
  if (cachedConfig) return cachedConfig;

  const programId = parsePublicKey(process.env.AEGIS_PROGRAM_ID, "AEGIS_PROGRAM_ID")
    ?? DEFAULT_AEGIS_PROGRAM_ID;
  const agentKeypair = parseOptionalKeypair("PRAXIS_AGENT_KEYPAIR", "PRAXIS_AGENT_KEYPAIR_PATH");
  const ownerKeypair = parseOptionalKeypair("PRAXIS_OWNER_KEYPAIR", "PRAXIS_OWNER_KEYPAIR_PATH");
  const nextAgentKeypair = parseOptionalKeypair(
    "PRAXIS_NEXT_AGENT_KEYPAIR",
    "PRAXIS_NEXT_AGENT_KEYPAIR_PATH",
  );
  const ownerAddress = parsePublicKey(process.env.AEGIS_OWNER_ADDRESS, "AEGIS_OWNER_ADDRESS")
    ?? ownerKeypair?.publicKey;
  const policyAddress = parsePublicKey(process.env.AEGIS_POLICY_ADDRESS, "AEGIS_POLICY_ADDRESS")
    ?? (ownerAddress ? findPolicyPda(ownerAddress, programId) : undefined);

  const stocksEnabled = process.env.PRAXIS_STOCKS_ENABLED?.trim() === "1";
  const stockUniverse = parseStockUniverse(process.env.PRAXIS_STOCK_UNIVERSE);
  const stockDecimals = parseStockDecimals(process.env.PRAXIS_STOCK_DECIMALS);
  const stockMints = parseStockMints(process.env.PRAXIS_STOCK_MINTS);
  const scheduleHourUtc = parseScheduleHour(process.env.PRAXIS_SCHEDULE_HOUR_UTC);

  cachedConfig = {
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL,
    rpcUrl: process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899",
    researchRpcUrl: process.env.PRAXIS_RESEARCH_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    commitment: parseCommitment(process.env.SOLANA_COMMITMENT),
    programId,
    policyAddress,
    ownerAddress,
    agentKeypair,
    ownerKeypair,
    nextAgentKeypair,
    addressBook: parseAddressBook(process.env.PRAXIS_ADDRESS_BOOK),
    tokens: parseTokens(process.env.PRAXIS_TOKENS, {
      stocksEnabled,
      stockUniverse,
      stockDecimals,
      stockMints,
    }),
    indexerUrl: process.env.PRAXIS_INDEXER_URL,
    stocksEnabled,
    prestocksApiUrl: process.env.PRAXIS_PRESTOCKS_API_URL?.trim() || DEFAULT_PRESTOCKS_API_URL,
    prestocksTimeoutMs: parsePrestocksTimeout(process.env.PRAXIS_PRESTOCKS_TIMEOUT_MS),
    stockUniverse,
    stockDecimals,
    stockMints,
    scheduleHourUtc,
  };

  // An operator override is authoritative: seed the resolver cache so the
  // chain lookup is skipped entirely for those mints.
  for (const token of cachedConfig.tokens) {
    const override = stockDecimals[token.symbol];
    if (override !== undefined) primeMintDecimals(token.mint, override);
  }

  return cachedConfig;
}

export function configForWalletOwner(
  ownerAddress: PublicKey,
  base: PraxisServerConfig = getServerConfig(),
): PraxisServerConfig {
  return {
    ...base,
    ownerAddress,
    policyAddress: findPolicyPda(ownerAddress, base.programId),
  };
}

/**
 * Guard the shared-agent-key footgun in multi-tenant production.
 *
 * Today the backend holds ONE agent key and registers it as the agent authority
 * on every wallet's policy, so a single key compromise can move funds out of
 * every vault it serves (each bounded by that policy's own caps). That is fine
 * for a single owner or a dev/devnet deploy, but serving many distinct wallets
 * from one shared key in production is a deliberate risk — it must be
 * acknowledged, never the silent default.
 *
 * Allowed without acknowledgement: any non-production env, remote agent custody
 * (`PRAXIS_AGENT_SIGNER_URL`), no agent key configured at all, or the single
 * configured owner (`AEGIS_OWNER_ADDRESS` / owner keypair) signing in. Anything
 * else in production requires an explicit `PRAXIS_ALLOW_SHARED_AGENT_KEY=1`.
 */
export function assertSharedAgentKeySafe(
  ownerAddress: string,
  base: PraxisServerConfig = getServerConfig(),
): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.PRAXIS_ALLOW_SHARED_AGENT_KEY === "1") return;
  if (process.env.PRAXIS_AGENT_SIGNER_URL?.trim()) return; // remote custody: key isn't in-process
  if (!base.agentKeypair) return; // no shared local key to misuse
  // The one configured owner signing into its own policy is single-tenant — safe.
  if (base.ownerAddress && base.ownerAddress.toBase58() === ownerAddress) return;

  throw new PraxisConfigError(
    "Refusing to serve this wallet with a shared agent key in production. The configured " +
      "agent key is the on-chain agent authority on every policy it is registered to, so a " +
      "single key compromise can drain every vault it serves. Use remote agent custody " +
      "(PRAXIS_AGENT_SIGNER_URL), restrict the deployment to the single configured owner " +
      "(AEGIS_OWNER_ADDRESS), or set PRAXIS_ALLOW_SHARED_AGENT_KEY=1 to explicitly accept the " +
      "shared-key model.",
  );
}

export function requirePolicyAddress(config = getServerConfig()): PublicKey {
  if (!config.policyAddress) {
    throw new PraxisConfigError(
      "Set AEGIS_POLICY_ADDRESS, AEGIS_OWNER_ADDRESS, or PRAXIS_OWNER_KEYPAIR so the backend can locate the Aegis policy PDA.",
    );
  }
  return config.policyAddress;
}

export function requireAgentKeypair(config = getServerConfig()): Keypair {
  if (!config.agentKeypair) {
    throw new PraxisConfigError(
      "Set PRAXIS_AGENT_KEYPAIR or PRAXIS_AGENT_KEYPAIR_PATH to the scoped Aegis agent keypair.",
    );
  }
  return config.agentKeypair;
}

export function requireOwnerKeypair(config = getServerConfig()): Keypair {
  if (!config.ownerKeypair) {
    throw new PraxisConfigError(
      "This owner mutation requires PRAXIS_OWNER_KEYPAIR or PRAXIS_OWNER_KEYPAIR_PATH.",
    );
  }
  return config.ownerKeypair;
}

export function requireNextAgentKeypair(config = getServerConfig()): Keypair {
  if (!config.nextAgentKeypair) {
    throw new PraxisConfigError(
      "Rotate requires PRAXIS_NEXT_AGENT_KEYPAIR or PRAXIS_NEXT_AGENT_KEYPAIR_PATH. Refusing to re-enable the current agent key by default.",
    );
  }
  return config.nextAgentKeypair;
}

export function validatePublicKey(value: string, name = "address"): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new PraxisConfigError(`${name} must be a valid Solana public key`);
  }
}

function parseCommitment(value: string | undefined): Commitment {
  if (value === "processed" || value === "confirmed" || value === "finalized") return value;
  return "confirmed";
}

function parsePublicKey(value: string | undefined, name: string): PublicKey | undefined {
  if (!value?.trim()) return undefined;
  try {
    return new PublicKey(value.trim());
  } catch {
    throw new PraxisConfigError(`${name} must be a valid Solana public key`);
  }
}

function parseOptionalKeypair(valueEnv: string, pathEnv: string): Keypair | undefined {
  const pathValue = process.env[pathEnv]?.trim();
  if (pathValue) return parseKeypair(readKeypairFile(pathValue), pathEnv);

  const value = process.env[valueEnv]?.trim();
  if (!value) return undefined;
  return parseKeypair(value, valueEnv);
}

function readKeypairFile(pathValue: string): string {
  const fullPath = isAbsolute(pathValue)
    ? pathValue
    : resolve(/* turbopackIgnore: true */ process.cwd(), pathValue);
  if (!existsSync(fullPath)) {
    throw new PraxisConfigError(`keypair file does not exist: ${fullPath}`);
  }
  return readFileSync(fullPath, "utf8");
}

function parseKeypair(raw: string, name: string): Keypair {
  const trimmed = raw.trim();
  try {
    if (trimmed.startsWith("[")) {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      return Keypair.fromSecretKey(Uint8Array.from(parsed));
    }
    return Keypair.fromSecretKey(bs58.decode(trimmed));
  } catch (error) {
    throw new PraxisConfigError(
      `${name} must be a keypair JSON array, a path to one, or a base58-encoded 64-byte secret key (${String(error)})`,
    );
  }
}

function parseAddressBook(raw: string | undefined): AddressBookEntry[] {
  if (!raw?.trim()) return defaultAddressBook();
  const parsed = parseJsonArray<AddressBookEntry>(raw, "PRAXIS_ADDRESS_BOOK");
  return parsed.map((entry) => {
    const label = String(entry.label ?? "").trim().toLowerCase();
    const name = String(entry.name ?? "").trim();
    const address = validatePublicKey(String(entry.address ?? ""), `address book entry ${label}`).toBase58();
    if (!label || !name) throw new PraxisConfigError("address book entries require label, name, and address");
    return { label, name, address, note: entry.note ? String(entry.note) : undefined };
  });
}

function defaultAddressBook(): AddressBookEntry[] {
  if (process.env.NODE_ENV === "production" && process.env.PRAXIS_ALLOW_DEMO_DATA !== "1") {
    return [];
  }
  return DEFAULT_CONTACTS;
}

function parseTokens(
  raw: string | undefined,
  stock: {
    stocksEnabled: boolean;
    stockUniverse: string[] | undefined;
    stockDecimals: Record<string, number>;
    stockMints: Record<string, string>;
  },
): TokenInfo[] {
  const base = raw?.trim() ? parseBaseTokens(raw) : [...DEFAULT_TOKENS];
  if (!stock.stocksEnabled) return base;
  const seen = new Set(base.map((token) => token.mint));
  const stocks = buildStockTokens(
    stock.stockDecimals,
    stock.stockUniverse,
    stock.stockMints,
  ).filter((token) => !seen.has(token.mint));
  return [...base, ...stocks];
}

/**
 * `PRAXIS_SCHEDULE_HOUR_UTC` — the hour the scheduled-buy cron fires. Must
 * agree with `vercel.json`; schedules anchor their fire time to it so a
 * "every Monday" buy is actually due when Monday's tick runs.
 */
function parseScheduleHour(raw: string | undefined): number {
  const DEFAULT_HOUR = 9;
  if (!raw?.trim()) return DEFAULT_HOUR;
  const hour = Number(raw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new PraxisConfigError("PRAXIS_SCHEDULE_HOUR_UTC must be an integer from 0 to 23");
  }
  return hour;
}

/**
 * `PRAXIS_STOCK_MINTS` — a JSON map of symbol → mint for a demo cluster,
 * e.g. `{"OPENAI":"<devnet mint>"}`. The PreStocks mints are mainnet-only,
 * so a devnet deploy needs mirrors (`bun run praxis:setup-devnet-stocks`).
 */
function parseStockMints(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PraxisConfigError(`PRAXIS_STOCK_MINTS must be a valid JSON object (${String(error)})`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PraxisConfigError("PRAXIS_STOCK_MINTS must be a JSON object of symbol → mint");
  }
  const known = new Set(STOCK_SYMBOLS);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const symbol = key.trim().replace(/^\$/, "").toUpperCase();
    if (!known.has(symbol)) {
      throw new PraxisConfigError(`PRAXIS_STOCK_MINTS.${key} is not a known stock symbol`);
    }
    out[symbol] = validatePublicKey(String(value ?? ""), `PRAXIS_STOCK_MINTS.${key}`).toBase58();
  }
  return out;
}

/**
 * `PRAXIS_STOCK_DECIMALS` — a JSON map of confirmed per-symbol decimals, e.g.
 * `{"OPENAI":9}`. An escape hatch for operators who have verified the mints
 * (and for offline demos); anything omitted is resolved from the chain.
 */
function parseStockDecimals(raw: string | undefined): Record<string, number> {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PraxisConfigError(`PRAXIS_STOCK_DECIMALS must be a valid JSON object (${String(error)})`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PraxisConfigError("PRAXIS_STOCK_DECIMALS must be a JSON object of symbol → decimals");
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const symbol = key.trim().replace(/^\$/, "").toUpperCase();
    const decimals = Number(value);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      throw new PraxisConfigError(`PRAXIS_STOCK_DECIMALS.${key} must be an integer from 0 to 18`);
    }
    out[symbol] = decimals;
  }
  return out;
}

function parseStockUniverse(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const known = new Set(STOCK_SYMBOLS);
  const symbols = [...new Set(raw.split(",").map((s) => s.trim().replace(/^\$/, "").toUpperCase()).filter(Boolean))].filter(
    (s) => known.has(s),
  );
  return symbols.length > 0 ? symbols : undefined;
}

function parsePrestocksTimeout(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_PRESTOCKS_TIMEOUT_MS;
}

function parseBaseTokens(raw: string): TokenInfo[] {
  const parsed = parseJsonArray<TokenInfo>(raw, "PRAXIS_TOKENS");
  return parsed.map((token) => {
    const symbol = String(token.symbol ?? "").trim().toUpperCase();
    if (!symbol) throw new PraxisConfigError("token entries require a symbol");
    const decimals = Number(token.decimals);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      throw new PraxisConfigError(`token ${symbol || "(unknown)"} decimals must be an integer from 0 to 18`);
    }
    return {
      symbol,
      mint: validatePublicKey(String(token.mint ?? ""), `token ${symbol}`).toBase58(),
      decimals,
      verified: Boolean(token.verified),
    };
  });
}

function parseJsonArray<T>(raw: string, name: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("expected an array");
    return parsed;
  } catch (error) {
    throw new PraxisConfigError(`${name} must be a valid JSON array (${String(error)})`);
  }
}

export function defaultAllowedPrograms(): string[] {
  return [SYSTEM_PROGRAM_ID.toBase58()];
}
