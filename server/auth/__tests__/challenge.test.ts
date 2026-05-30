import { describe, expect, test } from "bun:test";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

import { createWalletChallenge, verifyWalletChallenge } from "../challenge";
import { makeRequest, signMessage } from "../../testing/fixtures";

const ORIGIN = "https://praxis.test";
const URL = `${ORIGIN}/api/praxis/auth/verify`;

function issueAndSign(keypair = Keypair.generate()) {
  const address = keypair.publicKey.toBase58();
  const challenge = createWalletChallenge(address, makeRequest(URL, { origin: ORIGIN }));
  const signature = bs58.encode(signMessage(keypair, challenge.message));
  return { keypair, address, challenge, signature };
}

describe("wallet challenge", () => {
  test("verifies a correctly signed challenge", () => {
    const { address, challenge, signature } = issueAndSign();
    const verified = verifyWalletChallenge(
      { address, nonce: challenge.nonce, signature },
      makeRequest(URL, { origin: ORIGIN }),
    );
    expect(verified).toBe(address);
  });

  test("a nonce is single-use", () => {
    const { address, challenge, signature } = issueAndSign();
    verifyWalletChallenge({ address, nonce: challenge.nonce, signature }, makeRequest(URL, { origin: ORIGIN }));
    expect(() =>
      verifyWalletChallenge({ address, nonce: challenge.nonce, signature }, makeRequest(URL, { origin: ORIGIN })),
    ).toThrow(/missing or already used/);
  });

  test("rejects a signature from the wrong wallet", () => {
    const { address, challenge } = issueAndSign();
    const attacker = Keypair.generate();
    const forged = bs58.encode(signMessage(attacker, challenge.message));
    expect(() =>
      verifyWalletChallenge({ address, nonce: challenge.nonce, signature: forged }, makeRequest(URL, { origin: ORIGIN })),
    ).toThrow(/did not verify/);
  });

  test("rejects an origin mismatch", () => {
    const { address, challenge, signature } = issueAndSign();
    expect(() =>
      verifyWalletChallenge(
        { address, nonce: challenge.nonce, signature },
        makeRequest("https://evil.test/api/praxis/auth/verify", { origin: "https://evil.test" }),
      ),
    ).toThrow(/origin does not match/);
  });

  test("rejects an address that does not match the challenge", () => {
    const { challenge, signature } = issueAndSign();
    const other = Keypair.generate().publicKey.toBase58();
    expect(() =>
      verifyWalletChallenge({ address: other, nonce: challenge.nonce, signature }, makeRequest(URL, { origin: ORIGIN })),
    ).toThrow();
  });

  test("rejects a malformed signature encoding", () => {
    const { address, challenge } = issueAndSign();
    expect(() =>
      verifyWalletChallenge(
        { address, nonce: challenge.nonce, signature: "not-base58!!" },
        makeRequest(URL, { origin: ORIGIN }),
      ),
    ).toThrow(/base58-encoded Ed25519 signature/);
  });

  test("rejects an unknown nonce", () => {
    const { address, signature } = issueAndSign();
    expect(() =>
      verifyWalletChallenge({ address, nonce: "never-issued", signature }, makeRequest(URL, { origin: ORIGIN })),
    ).toThrow(/missing or already used/);
  });

  test("the challenge message binds domain, wallet, and nonce", () => {
    const { address, challenge } = issueAndSign();
    expect(challenge.message).toContain("praxis.test");
    expect(challenge.message).toContain(address);
    expect(challenge.message).toContain(challenge.nonce);
    expect(challenge.message).toContain("does not authorize a transaction");
  });
});
