import { afterEach, describe, expect, test } from "bun:test";
import { PublicKey, type Connection } from "@solana/web3.js";

import {
  __resetMintDecimalsCacheForTests,
  checkMintMovable,
  primeMintDecimals,
  resolveMintDecimals,
  resolveMintInfo,
} from "../mintDecimals";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../../aegis/constants";
import { STOCK_TOKEN_PROGRAM_ID } from "../universe";

const MINT = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const CLASSIC = TOKEN_PROGRAM_ID.toBase58();

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
    const verdict = await checkMintMovable(conn, MINT, CLASSIC);
    expect(verdict.movable).toBe(true);
    if (verdict.movable) expect(verdict.info.decimals).toBe(9);
  });

  test("a Token-2022 mint is refused — Aegis cannot move it at all", async () => {
    // The deployed agent_transfer_spl hard-requires the classic token program
    // and 165-byte accounts, so this is structural, not a cap to raise.
    const conn = connectionReturning(mintAccount(9, TOKEN_2022_PROGRAM_ID, 902));
    const verdict = await checkMintMovable(conn, MINT, CLASSIC);
    expect(verdict.movable).toBe(false);
    if (!verdict.movable && verdict.reason === "wrong-token-program") {
      expect(verdict.programId).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
    } else {
      throw new Error(`expected wrong-token-program, got ${JSON.stringify(verdict)}`);
    }
  });

  test("the PreStocks mints are exactly that case", () => {
    // Recorded from mainnet 2026-09-20; this is why stock buys are preview-only.
    expect(STOCK_TOKEN_PROGRAM_ID).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
    expect(STOCK_TOKEN_PROGRAM_ID).not.toBe(CLASSIC);
  });

  test("a mint missing from this cluster is refused, not assumed", async () => {
    const verdict = await checkMintMovable(connectionReturning(null), MINT, CLASSIC);
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
    const conn = connectionReturning(mintAccount(9, TOKEN_2022_PROGRAM_ID, 902));
    // The override answers "what scale"; only the chain answers "can Aegis
    // move this". Conflating them would let a pinned value wave through a
    // mint the program cannot touch.
    expect(await resolveMintDecimals(conn, MINT)).toBe(9);
    expect((await checkMintMovable(conn, MINT, CLASSIC)).movable).toBe(false);
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
});
