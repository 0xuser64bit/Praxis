import { describe, expect, test } from "bun:test";
import { RejectReason } from "@praxis/shared";

import {
  checkSwapPolicy,
  checkTokenTransferPolicy,
  checkTransferPolicy,
  effectiveSpentToday,
} from "../policy";
import { JUPITER_PROGRAM_ID } from "../../aegis/constants";
import { policyFixture, randomAddress, SYSTEM_PROGRAM, USDC } from "../../testing/fixtures";

const NOW = Math.floor(Date.now() / 1000);

describe("checkTransferPolicy (mirrors agent_transfer §5 order)", () => {
  test("allows a transfer within all limits", () => {
    const out = checkTransferPolicy(policyFixture(), 1_000_000_000n, randomAddress(), NOW);
    expect(out.allowed).toBe(true);
  });

  test("allows exactly the per-tx cap (== boundary)", () => {
    const out = checkTransferPolicy(policyFixture({ maxPerTx: 1_000n }), 1_000n, randomAddress(), NOW);
    expect(out.allowed).toBe(true);
  });

  test("rejects one base unit over the per-tx cap", () => {
    const out = checkTransferPolicy(policyFixture({ maxPerTx: 1_000n }), 1_001n, randomAddress(), NOW);
    expect(out.allowed).toBe(false);
    expect(out.reasonCode).toBe(RejectReason.OverPerTx);
  });

  test("rejects when spent_today + amount exceeds the daily limit", () => {
    const policy = policyFixture({ dailyLimit: 1_000n, spentToday: 900n, maxPerTx: 1_000n });
    const out = checkTransferPolicy(policy, 200n, randomAddress(), NOW);
    expect(out.reasonCode).toBe(RejectReason.OverDaily);
  });

  test("paused beats every other check", () => {
    const out = checkTransferPolicy(policyFixture({ paused: true }), 1n, randomAddress(), NOW);
    expect(out.reasonCode).toBe(RejectReason.Paused);
  });

  test("expired session is rejected", () => {
    const out = checkTransferPolicy(policyFixture({ expiryTs: NOW - 1 }), 1n, randomAddress(), NOW);
    expect(out.reasonCode).toBe(RejectReason.Expired);
  });

  test("recipient allow-list rejects an unlisted recipient", () => {
    const allowed = randomAddress();
    const policy = policyFixture({ allowedRecipients: [allowed] });
    expect(checkTransferPolicy(policy, 1n, allowed, NOW).allowed).toBe(true);
    expect(checkTransferPolicy(policy, 1n, randomAddress(), NOW).reasonCode).toBe(
      RejectReason.RecipientNotAllowed,
    );
  });

  test("day rollover resets the effective spend window", () => {
    const policy = policyFixture({ spentToday: 999n, dayStartTs: NOW - 90_000 });
    expect(effectiveSpentToday(policy, NOW)).toBe(0n);
    expect(checkTransferPolicy({ ...policy, dailyLimit: 1_000n, maxPerTx: 1_000n }, 1_000n, randomAddress(), NOW).allowed).toBe(true);
  });
});

describe("checkTokenTransferPolicy (separate envelope)", () => {
  const configured = (over = {}) =>
    policyFixture({ tokenMint: USDC.mint, tokenMaxPerTx: 100n, tokenDailyLimit: 1_000n, ...over });

  test("rejects when the token envelope is not configured", () => {
    const out = checkTokenTransferPolicy(policyFixture({ tokenMint: SYSTEM_PROGRAM }), USDC, 1n, randomAddress(), NOW);
    expect(out.allowed).toBe(false);
  });

  test("rejects a mint that is not the configured token_mint", () => {
    const policy = configured();
    const other = { ...USDC, mint: randomAddress(), symbol: "OTHER" };
    expect(checkTokenTransferPolicy(policy, other, 1n, randomAddress(), NOW).reasonCode).toBe(
      RejectReason.MintNotAllowed,
    );
  });

  test("enforces the token's own per-tx cap and daily limit", () => {
    expect(checkTokenTransferPolicy(configured(), USDC, 101n, randomAddress(), NOW).reasonCode).toBe(
      RejectReason.OverPerTx,
    );
    expect(
      checkTokenTransferPolicy(configured({ tokenSpentToday: 950n }), USDC, 100n, randomAddress(), NOW).reasonCode,
    ).toBe(RejectReason.OverDaily);
  });

  test("allows a configured, within-limit token transfer", () => {
    expect(checkTokenTransferPolicy(configured(), USDC, 50n, randomAddress(), NOW).allowed).toBe(true);
  });
});

describe("checkSwapPolicy (agent-layer, no on-chain reason code)", () => {
  test("rejects when Jupiter is not an allowed program", () => {
    const out = checkSwapPolicy(policyFixture({ allowedPrograms: [] }), USDC, JUPITER_PROGRAM_ID.toBase58(), NOW);
    expect(out.allowed).toBe(false);
    expect(out.reasonCode).toBeUndefined();
  });

  test("rejects an unverified output mint even when Jupiter is allowed", () => {
    const policy = policyFixture({ allowedPrograms: [JUPITER_PROGRAM_ID.toBase58()], allowedMints: [] });
    expect(checkSwapPolicy(policy, USDC, JUPITER_PROGRAM_ID.toBase58(), NOW).allowed).toBe(false);
  });

  test("allows a route only when both program and mint are allow-listed", () => {
    const policy = policyFixture({
      allowedPrograms: [JUPITER_PROGRAM_ID.toBase58()],
      allowedMints: [USDC.mint],
    });
    expect(checkSwapPolicy(policy, USDC, JUPITER_PROGRAM_ID.toBase58(), NOW).allowed).toBe(true);
  });
});
