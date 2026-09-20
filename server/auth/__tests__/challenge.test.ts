import { beforeEach, describe, expect, test } from "bun:test";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

import { createWalletChallenge, verifyWalletChallenge } from "../challenge";
import { MemoryNonceStore, resetNonceStoreForTests, type NonceStore } from "../nonceStore";
import { makeRequest, signMessage } from "../../testing/fixtures";

const ORIGIN = "https://praxis.test";
const URL = `${ORIGIN}/api/praxis/auth/verify`;

function issueAndSign(keypair = Keypair.generate()) {
  const address = keypair.publicKey.toBase58();
  const challenge = createWalletChallenge(address, makeRequest(URL, { origin: ORIGIN }));
  const signature = bs58.encode(signMessage(keypair, challenge.message));
  return { keypair, address, challenge, signature };
}

beforeEach(() => {
  resetNonceStoreForTests(new MemoryNonceStore());
});

describe("wallet challenge", () => {
  test("verifies a correctly signed challenge", async () => {
    const { address, challenge, signature } = issueAndSign();
    const verified = await verifyWalletChallenge(
      { address, nonce: challenge.nonce, signature },
      makeRequest(URL, { origin: ORIGIN }),
    );
    expect(verified).toBe(address);
  });

  test("a nonce is single-use", async () => {
    const { address, challenge, signature } = issueAndSign();
    await verifyWalletChallenge({ address, nonce: challenge.nonce, signature }, makeRequest(URL, { origin: ORIGIN }));
    await expect(
      verifyWalletChallenge({ address, nonce: challenge.nonce, signature }, makeRequest(URL, { origin: ORIGIN })),
    ).rejects.toThrow(/missing or already used/);
  });

  test("two concurrent redemptions of one nonce: exactly one wins", async () => {
    const { address, challenge, signature } = issueAndSign();
    const attempt = () =>
      verifyWalletChallenge({ address, nonce: challenge.nonce, signature }, makeRequest(URL, { origin: ORIGIN }));
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  test("a failing nonce store refuses the sign-in rather than allowing a replay", async () => {
    const broken: NonceStore = {
      consume: async () => {
        throw new Error("redis unreachable");
      },
    };
    resetNonceStoreForTests(broken);
    const { address, challenge, signature } = issueAndSign();
    // Fail CLOSED: a replay guard that degrades to "allow" is not a guard.
    await expect(
      verifyWalletChallenge({ address, nonce: challenge.nonce, signature }, makeRequest(URL, { origin: ORIGIN })),
    ).rejects.toThrow(/temporarily unavailable/);
  });

  test("a bad signature does not burn a pending nonce", async () => {
    const { keypair, address, challenge } = issueAndSign();
    const attacker = Keypair.generate();
    const forged = bs58.encode(signMessage(attacker, challenge.message));
    await expect(
      verifyWalletChallenge({ address, nonce: challenge.nonce, signature: forged }, makeRequest(URL, { origin: ORIGIN })),
    ).rejects.toThrow(/did not verify/);

    // The real owner can still redeem it: verification happens before the burn.
    const signature = bs58.encode(signMessage(keypair, challenge.message));
    await expect(
      verifyWalletChallenge({ address, nonce: challenge.nonce, signature }, makeRequest(URL, { origin: ORIGIN })),
    ).resolves.toBe(address);
  });

  test("rejects a signature from the wrong wallet", async () => {
    const { address, challenge } = issueAndSign();
    const attacker = Keypair.generate();
    const forged = bs58.encode(signMessage(attacker, challenge.message));
    await expect(
      verifyWalletChallenge({ address, nonce: challenge.nonce, signature: forged }, makeRequest(URL, { origin: ORIGIN })),
    ).rejects.toThrow(/did not verify/);
  });

  test("rejects an origin mismatch", async () => {
    const { address, challenge, signature } = issueAndSign();
    await expect(
      verifyWalletChallenge(
        { address, nonce: challenge.nonce, signature },
        makeRequest("https://evil.test/api/praxis/auth/verify", { origin: "https://evil.test" }),
      ),
    ).rejects.toThrow(/origin does not match/);
  });

  test("rejects an address that does not match the challenge", async () => {
    const { challenge, signature } = issueAndSign();
    const other = Keypair.generate().publicKey.toBase58();
    await expect(
      verifyWalletChallenge({ address: other, nonce: challenge.nonce, signature }, makeRequest(URL, { origin: ORIGIN })),
    ).rejects.toThrow();
  });

  test("rejects a malformed signature encoding", async () => {
    const { address, challenge } = issueAndSign();
    await expect(
      verifyWalletChallenge(
        { address, nonce: challenge.nonce, signature: "not-base58!!" },
        makeRequest(URL, { origin: ORIGIN }),
      ),
    ).rejects.toThrow(/base58-encoded Ed25519 signature/);
  });

  test("rejects an unknown nonce", async () => {
    const { address, signature } = issueAndSign();
    await expect(
      verifyWalletChallenge({ address, nonce: "never-issued", signature }, makeRequest(URL, { origin: ORIGIN })),
    ).rejects.toThrow(/missing or already used/);
  });

  test("the challenge message binds domain, wallet, and nonce", () => {
    const { address, challenge } = issueAndSign();
    expect(challenge.message).toContain("praxis.test");
    expect(challenge.message).toContain(address);
    expect(challenge.message).toContain(challenge.nonce);
    expect(challenge.message).toContain("does not authorize a transaction");
  });
});
