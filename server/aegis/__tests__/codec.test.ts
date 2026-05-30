import { describe, expect, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";
import { ActionKind, RejectReason } from "@praxis/shared";

import { decodeActionLog, decodePolicyAccount } from "../codec";
import {
  encodeActionLog,
  encodePolicyAccount,
  policyFixture,
  randomAddress,
  SYSTEM_PROGRAM,
  type RawActionRecord,
} from "../../testing/fixtures";

describe("decodePolicyAccount", () => {
  test("round-trips every field including the appended SPL envelope", () => {
    const policy = policyFixture({
      maxPerTx: 1_234_567n,
      dailyLimit: 9_999_999_999n,
      spentToday: 42n,
      allowedRecipients: [randomAddress(), randomAddress()],
      allowedMints: [randomAddress()],
      paused: true,
      tokenMint: randomAddress(),
      tokenMaxPerTx: 7n,
      tokenDailyLimit: 700n,
      tokenSpentToday: 70n,
    });
    const address = new PublicKey(policy.address);

    const decoded = decodePolicyAccount(address, encodePolicyAccount(policy), policy.vaultBalance);

    expect(decoded).toEqual(policy);
  });

  test("rejects a buffer with the wrong account discriminator", () => {
    const bad = Buffer.alloc(400);
    expect(() => decodePolicyAccount(new PublicKey(randomAddress()), bad, 0n)).toThrow(
      /not an Aegis PolicyAccount/,
    );
  });

  test("guards against truncated account data", () => {
    const policy = policyFixture();
    const full = encodePolicyAccount(policy);
    const truncated = full.subarray(0, full.length - 4);
    expect(() => decodePolicyAccount(new PublicKey(policy.address), truncated, 0n)).toThrow(
      /truncated/,
    );
  });
});

describe("decodeActionLog", () => {
  function record(over: Partial<RawActionRecord>): RawActionRecord {
    return {
      kind: 0,
      amount: 1n,
      target: randomAddress(),
      mint: SYSTEM_PROGRAM,
      result: 1,
      reason: 0,
      ts: 1000,
      ...over,
    };
  }

  test("returns entries newest-first using head/count", () => {
    const records = [
      record({ ts: 100, amount: 1n }),
      record({ ts: 200, amount: 2n }),
      record({ ts: 300, amount: 3n }),
    ];
    const data = encodeActionLog({
      policy: randomAddress(),
      head: 3,
      count: 3,
      total: 3n,
      records,
    });

    const out = decodeActionLog(data);

    expect(out.map((e) => e.amount)).toEqual([3n, 2n, 1n]);
    expect(out[0].result).toBe("allowed");
    expect(out[0].kind).toBe(ActionKind.Transfer);
  });

  test("decodes SPL kind, mint and rejected reason codes", () => {
    const mint = randomAddress();
    const data = encodeActionLog({
      policy: randomAddress(),
      head: 1,
      count: 1,
      total: 1n,
      records: [record({ kind: 1, mint, result: 0, reason: RejectReason.OverDaily })],
    });

    const [entry] = decodeActionLog(data);

    expect(entry.kind).toBe(ActionKind.TransferSpl);
    expect(entry.mint).toBe(mint);
    expect(entry.result).toBe("rejected");
    expect(entry.reasonCode).toBe(RejectReason.OverDaily);
  });

  test("never returns more than the stored count", () => {
    const data = encodeActionLog({
      policy: randomAddress(),
      head: 2,
      count: 2,
      total: 2n,
      records: [record({ ts: 1 }), record({ ts: 2 })],
    });
    expect(decodeActionLog(data)).toHaveLength(2);
  });
});
