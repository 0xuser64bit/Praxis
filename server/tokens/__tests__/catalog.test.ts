import { afterEach, describe, expect, test } from "bun:test";
import { PublicKey, type Connection } from "@solana/web3.js";

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../../aegis/constants";
import type { PraxisServerConfig } from "../../env";
import { __resetMintDecimalsCacheForTests } from "../../stocks/mintDecimals";
import { resolveTokenCatalog } from "../catalog";

const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WSOL = "So11111111111111111111111111111111111111112";

type Account = { data: Buffer; owner: PublicKey } | null;

/** A minimal mint account: decimals live at byte 44 of the 82-byte base. */
function mintAccount(decimals: number, owner: PublicKey, size = 82): Account {
  const data = Buffer.alloc(size);
  data[44] = decimals;
  return { data, owner };
}

function configWith(tokens: { symbol: string; mint: string; decimals: number }[]) {
  return { tokens: tokens.map((t) => ({ ...t, verified: true })) } as unknown as PraxisServerConfig;
}

function clusterWith(accounts: Record<string, Account>, onBatch?: () => void): Connection {
  return {
    getMultipleAccountsInfo: async (addresses: PublicKey[]) => {
      onBatch?.();
      return addresses.map((address) => accounts[address.toBase58()] ?? null);
    },
    getAccountInfo: async (address: PublicKey) => accounts[address.toBase58()] ?? null,
  } as unknown as Connection;
}

afterEach(() => {
  __resetMintDecimalsCacheForTests();
  delete process.env.PRAXIS_ALLOW_UNVERIFIED_MINTS;
});

describe("token catalog", () => {
  test("a configured mint under the wrong program is reported, never offered", async () => {
    // This is the devnet reality that shipped: mainnet USDC resolves to a
    // plain System-owned account there, so the picker offered a mint whose
    // envelope the program could never use — and said so only after the
    // owner had signed.
    const catalog = await resolveTokenCatalog(
      configWith([{ symbol: "USDC", mint: USDC, decimals: 6 }]),
      clusterWith({ [USDC]: mintAccount(6, SYSTEM_PROGRAM) }),
    );
    expect(catalog).toHaveLength(1);
    expect(catalog[0].status).toBe("wrong-program");
    expect(catalog[0].programId).toBe(SYSTEM_PROGRAM.toBase58());
    expect(catalog[0].decimals).toBeNull();
  });

  test("an absent mint is 'missing' — a different problem from 'wrong program'", async () => {
    const catalog = await resolveTokenCatalog(
      configWith([{ symbol: "JUP", mint: JUP, decimals: 6 }]),
      clusterWith({ [JUP]: null }),
    );
    expect(catalog[0].status).toBe("missing");
  });

  test("SPL Token and Token-2022 mints are movable, at the chain's decimals", async () => {
    const catalog = await resolveTokenCatalog(
      configWith([
        { symbol: "USDC", mint: USDC, decimals: 6 },
        // Configured 6dp but 9dp on chain. The chain wins: it is the exponent
        // every amount is actually scaled by.
        { symbol: "BONK", mint: BONK, decimals: 6 },
      ]),
      clusterWith({
        [USDC]: mintAccount(6, TOKEN_PROGRAM_ID),
        [BONK]: mintAccount(9, TOKEN_2022_PROGRAM_ID, 902),
      }),
    );
    expect(catalog.map((e) => e.status)).toEqual(["movable", "movable"]);
    expect(catalog[1].decimals).toBe(9);
  });

  test("wrapped SOL is flagged native — a real mint, but not an envelope candidate", async () => {
    const catalog = await resolveTokenCatalog(
      configWith([{ symbol: "SOL", mint: WSOL, decimals: 9 }]),
      clusterWith({ [WSOL]: mintAccount(9, TOKEN_PROGRAM_ID) }),
    );
    expect(catalog[0].native).toBe(true);
  });

  test("the whole catalog costs one RPC round trip, not one per mint", async () => {
    let batches = 0;
    await resolveTokenCatalog(
      configWith([
        { symbol: "USDC", mint: USDC, decimals: 6 },
        { symbol: "JUP", mint: JUP, decimals: 6 },
        { symbol: "BONK", mint: BONK, decimals: 5 },
      ]),
      clusterWith(
        {
          [USDC]: mintAccount(6, TOKEN_PROGRAM_ID),
          [JUP]: mintAccount(6, TOKEN_PROGRAM_ID),
          [BONK]: mintAccount(5, TOKEN_PROGRAM_ID),
        },
        () => {
          batches += 1;
        },
      ),
    );
    expect(batches).toBe(1);
  });

  test("an RPC failure reads as 'missing', not as a movable mint", async () => {
    const broken = {
      getMultipleAccountsInfo: async () => {
        throw new Error("rpc down");
      },
    } as unknown as Connection;
    const catalog = await resolveTokenCatalog(
      configWith([
        { symbol: "USDC", mint: USDC, decimals: 6 },
        { symbol: "JUP", mint: JUP, decimals: 6 },
      ]),
      broken,
    );
    expect(catalog.every((e) => e.status === "missing")).toBe(true);
  });

  test("PRAXIS_ALLOW_UNVERIFIED_MINTS keeps the catalog in step with the Aegis client", async () => {
    process.env.PRAXIS_ALLOW_UNVERIFIED_MINTS = "1";
    // The escape hatch lets the client configure any mint. If the catalog
    // still filtered, the product would hide mints the backend would accept.
    const catalog = await resolveTokenCatalog(
      configWith([{ symbol: "USDC", mint: USDC, decimals: 6 }]),
      clusterWith({ [USDC]: null }),
    );
    expect(catalog[0].status).toBe("movable");
  });
});
