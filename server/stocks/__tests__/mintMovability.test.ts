import { afterEach, describe, expect, test } from "bun:test";
import { PublicKey, type Connection } from "@solana/web3.js";

import {
  __resetMintDecimalsCacheForTests,
  checkMintMovable,
  checkMintsMovable,
  primeMintDecimals,
  resolveMintDecimals,
  resolveMintInfo,
  supportedTokenPrograms,
} from "../mintDecimals";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../../aegis/constants";
import { STOCK_TOKEN_PROGRAM_ID } from "../universe";

const MINT = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const CLASSIC = TOKEN_PROGRAM_ID.toBase58();
const SUPPORTED = supportedTokenPrograms(CLASSIC, TOKEN_2022_PROGRAM_ID.toBase58());

/** A minimal mint account: decimals live at byte 44 of the 82-byte base. */
function mintAccount(decimals: number, owner: PublicKey, size = 82) {
  const data = Buffer.alloc(size);
  data[44] = decimals;
  return { data, owner, lamports: 1, executable: false, rentEpoch: 0 };
}

function connectionReturning(account: unknown): Connection {
  return { getAccountInfo: async () => account } as unknown as Connection;
}

afterEach(() => {
  __resetMintDecimalsCacheForTests();
});

describe("mint movability", () => {
  test("a classic SPL mint is movable and reports its decimals", async () => {
    const conn = connectionReturning(mintAccount(9, TOKEN_PROGRAM_ID));
    const verdict = await checkMintMovable(conn, MINT, SUPPORTED);
    expect(verdict.movable).toBe(true);
    if (verdict.movable) expect(verdict.info.decimals).toBe(9);
  });

  test("a Token-2022 mint is movable — this is what makes stock buys executable", async () => {
    const conn = connectionReturning(mintAccount(9, TOKEN_2022_PROGRAM_ID, 902));
    const verdict = await checkMintMovable(conn, MINT, SUPPORTED);
    expect(verdict.movable).toBe(true);
    if (verdict.movable) expect(verdict.info.decimals).toBe(9);
  });

  test("the PreStocks mints are Token-2022, so they need that support", () => {
    // Recorded from mainnet 2026-09-20.
    expect(STOCK_TOKEN_PROGRAM_ID).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
    expect(SUPPORTED).toContain(STOCK_TOKEN_PROGRAM_ID);
  });

  test("a mint under any other token program is still refused", async () => {
    const alien = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
    const conn = connectionReturning(mintAccount(9, alien));
    const verdict = await checkMintMovable(conn, MINT, SUPPORTED);
    expect(verdict.movable).toBe(false);
    if (!verdict.movable && verdict.reason === "wrong-token-program") {
      expect(verdict.programId).toBe(alien.toBase58());
    } else {
      throw new Error(`expected wrong-token-program, got ${JSON.stringify(verdict)}`);
    }
  });

  test("a mint missing from this cluster is refused, not assumed", async () => {
    const verdict = await checkMintMovable(connectionReturning(null), MINT, SUPPORTED);
    expect(verdict.movable).toBe(false);
    if (!verdict.movable) expect(verdict.reason).toBe("unresolved");
  });

  test("an RPC failure is refused, not assumed", async () => {
    const conn = {
      getAccountInfo: async () => {
        throw new Error("rpc down");
      },
    } as unknown as Connection;
    expect(await resolveMintInfo(conn, MINT)).toBeUndefined();
  });

  test("an account that is not a mint is refused", async () => {
    // Reading byte 44 of an arbitrary account and calling it a scale is how
    // you move the wrong amount.
    const conn = connectionReturning(mintAccount(9, new PublicKey("11111111111111111111111111111111")));
    expect(await resolveMintInfo(conn, MINT)).toBeUndefined();
  });

  test("an operator decimals override does not imply movability", async () => {
    primeMintDecimals(MINT, 9);
    const alien = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
    const conn = connectionReturning(mintAccount(9, alien));
    // The override answers "what scale"; only the chain answers "can Aegis
    // move this". Conflating them would let a pinned value wave through a
    // mint the program cannot touch.
    expect(await resolveMintDecimals(conn, MINT)).toBe(9);
    expect((await checkMintMovable(conn, MINT, SUPPORTED)).movable).toBe(false);
  });

  test("results are cached — decimals are immutable", async () => {
    let calls = 0;
    const conn = {
      getAccountInfo: async () => {
        calls += 1;
        return mintAccount(9, TOKEN_PROGRAM_ID);
      },
    } as unknown as Connection;
    await resolveMintInfo(conn, MINT);
    await resolveMintInfo(conn, MINT);
    expect(calls).toBe(1);
  });

  test("many mints resolve in one batched read, with per-mint verdicts", async () => {
    // A catalog asks about every configured mint at once; N serial
    // getAccountInfo calls would turn one page load into N round trips.
    const good = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
    const alien = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
    const absent = "So11111111111111111111111111111111111111112";
    let batches = 0;
    const conn = {
      getMultipleAccountsInfo: async (addresses: PublicKey[]) => {
        batches += 1;
        return addresses.map((address) =>
          address.toBase58() === good
            ? mintAccount(9, TOKEN_2022_PROGRAM_ID, 902)
            : address.toBase58() === alien
              ? mintAccount(9, new PublicKey(alien))
              : null,
        );
      },
    } as unknown as Connection;

    const verdicts = await checkMintsMovable(conn, [good, alien, absent], SUPPORTED);
    expect(batches).toBe(1);
    expect(verdicts.get(good)?.movable).toBe(true);
    const alienVerdict = verdicts.get(alien);
    expect(alienVerdict?.movable).toBe(false);
    if (alienVerdict && !alienVerdict.movable) {
      expect(alienVerdict.reason).toBe("wrong-token-program");
    }
    const absentVerdict = verdicts.get(absent);
    if (absentVerdict && !absentVerdict.movable) {
      expect(absentVerdict.reason).toBe("unresolved");
    }
  });

  test("a mint already cached is not re-fetched by the batched path", async () => {
    const mint = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
    await resolveMintInfo(connectionReturning(mintAccount(9, TOKEN_PROGRAM_ID)), mint);
    const conn = {
      getMultipleAccountsInfo: async () => {
        throw new Error("should not be called");
      },
    } as unknown as Connection;
    expect((await checkMintsMovable(conn, [mint], SUPPORTED)).get(mint)?.movable).toBe(true);
  });
});
