import { describe, expect, test } from "bun:test";
import { explainPolicy } from "../policyExplainer";
import { policyFixture } from "../../testing/fixtures";

function text(blocks: ReturnType<typeof explainPolicy>): string {
  return blocks.map((b) => (b.type === "prose" ? b.text : "")).join("\n");
}

describe("explainPolicy", () => {
  const now = 1_900_000_000;

  test("general explanation includes per-tx cap and daily remaining", () => {
    const policy = policyFixture({
      maxPerTx: 1_000_000_000n,
      dailyLimit: 5_000_000_000n,
      spentToday: 1_000_000_000n,
      expiryTs: now + 3600,
      paused: false,
    });
    const out = text(explainPolicy(policy, now, "general"));
    expect(out).toContain("1"); // 1 SOL per-tx
    expect(out.toLowerCase()).toContain("per transaction");
    expect(out.toLowerCase()).toContain("remaining");
  });

  test("paused policy says transfers are paused", () => {
    const policy = policyFixture({ paused: true });
    const out = text(explainPolicy(policy, now, "general")).toLowerCase();
    expect(out).toContain("paused");
  });

  test("expired session is called out", () => {
    const policy = policyFixture({ expiryTs: now - 10 });
    const out = text(explainPolicy(policy, now, "expiry")).toLowerCase();
    expect(out).toContain("expired");
  });

  test("empty recipient allow-list says any recipient", () => {
    const policy = policyFixture({ allowedRecipients: [] });
    const out = text(explainPolicy(policy, now, "allowlist")).toLowerCase();
    expect(out).toContain("any recipient");
  });

  test("remaining today ignores spent after the 24h window rolls", () => {
    const policy = policyFixture({
      dailyLimit: 5_000_000_000n,
      spentToday: 4_000_000_000n,
      dayStartTs: now - 86_400 - 1, // window expired
      expiryTs: now + 3600,
    });
    const out = text(explainPolicy(policy, now, "caps"));
    // Full daily limit remaining after rollover, not 1 SOL.
    expect(out).toContain("5");
    expect(out.toLowerCase()).toContain("remaining");
    expect(out).not.toMatch(/1 SOL remaining/i);
  });
});
