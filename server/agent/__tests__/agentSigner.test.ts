import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import {
  HttpRemoteAgentSigner,
  LocalKeypairSigner,
  requireAgentSigner,
  resolveAgentSigner,
  resolveNextAgentPublicKey,
} from "../agentSigner";
import { PraxisConfigError } from "../../errors";
import { signEd25519 } from "../../../signer/handler";

const BLOCKHASH = Keypair.generate().publicKey.toBase58();

function txFor(payer: PublicKey): Transaction {
  return new Transaction({ feePayer: payer, blockhash: BLOCKHASH, lastValidBlockHeight: 1 }).add(
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
  );
}

describe("LocalKeypairSigner", () => {
  test("signs a transaction that verifies against the agent key", async () => {
    const kp = Keypair.generate();
    const signer = new LocalKeypairSigner(kp);
    expect(signer.publicKey.equals(kp.publicKey)).toBe(true);
    const tx = await signer.signTransaction(txFor(kp.publicKey));
    expect(tx.verifySignatures()).toBe(true);
  });
});

describe("HttpRemoteAgentSigner", () => {
  function signingFetch(kp: Keypair, calls: { auth?: string } = {}) {
    return (async (_url: string, init?: RequestInit) => {
      calls.auth = (init?.headers as Record<string, string>)?.authorization;
      const message = JSON.parse(init!.body as string).message as string;
      const signature = signEd25519(kp, Buffer.from(message, "base64")).toString("base64");
      return Response.json({ signature });
    }) as unknown as typeof fetch;
  }

  test("applies a remote signature and sends the bearer token", async () => {
    const kp = Keypair.generate();
    const calls: { auth?: string } = {};
    const signer = new HttpRemoteAgentSigner("https://signer.test", kp.publicKey, "secret-token", 8000, signingFetch(kp, calls));
    const tx = await signer.signTransaction(txFor(kp.publicKey));
    expect(tx.verifySignatures()).toBe(true);
    expect(calls.auth).toBe("Bearer secret-token");
  });

  test("fails closed on a non-200 response", async () => {
    const kp = Keypair.generate();
    const fetchImpl = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    const signer = new HttpRemoteAgentSigner("https://signer.test", kp.publicKey, "t", 8000, fetchImpl);
    await expect(signer.signTransaction(txFor(kp.publicKey))).rejects.toBeInstanceOf(PraxisConfigError);
  });

  test("fails closed when the signer returns no signature", async () => {
    const kp = Keypair.generate();
    const fetchImpl = (async () => Response.json({})) as unknown as typeof fetch;
    const signer = new HttpRemoteAgentSigner("https://signer.test", kp.publicKey, "t", 8000, fetchImpl);
    await expect(signer.signTransaction(txFor(kp.publicKey))).rejects.toThrow(/did not return a signature/);
  });

  test("fails closed when the network throws", async () => {
    const kp = Keypair.generate();
    const fetchImpl = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    const signer = new HttpRemoteAgentSigner("https://signer.test", kp.publicKey, "t", 8000, fetchImpl);
    await expect(signer.signTransaction(txFor(kp.publicKey))).rejects.toThrow();
  });
});

describe("resolveAgentSigner", () => {
  const KEYS = [
    "PRAXIS_AGENT_SIGNER_URL",
    "PRAXIS_AGENT_PUBLIC_KEY",
    "PRAXIS_AGENT_SIGNER_TOKEN",
    "PRAXIS_ALLOW_LOCAL_AGENT_KEY",
    "NODE_ENV",
  ];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) Reflect.deleteProperty(process.env, k);
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
      else process.env[k] = saved[k];
    }
  });

  test("returns a remote signer when the URL, pubkey, and token are set", () => {
    const kp = Keypair.generate();
    process.env.PRAXIS_AGENT_SIGNER_URL = "https://signer.test/sign";
    process.env.PRAXIS_AGENT_PUBLIC_KEY = kp.publicKey.toBase58();
    process.env.PRAXIS_AGENT_SIGNER_TOKEN = "tok";
    const signer = resolveAgentSigner();
    expect(signer).toBeInstanceOf(HttpRemoteAgentSigner);
    expect(signer?.publicKey.equals(kp.publicKey)).toBe(true);
  });

  test("throws when the signer URL is set without a public key", () => {
    process.env.PRAXIS_AGENT_SIGNER_URL = "https://signer.test/sign";
    process.env.PRAXIS_AGENT_SIGNER_TOKEN = "tok";
    expect(() => resolveAgentSigner()).toThrow(/PRAXIS_AGENT_PUBLIC_KEY is required/);
  });

  test("returns a local signer from a keypair outside production", () => {
    const kp = Keypair.generate();
    expect(resolveAgentSigner(kp)).toBeInstanceOf(LocalKeypairSigner);
  });

  test("refuses a raw keypair in production without the opt-in", () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    expect(() => resolveAgentSigner(Keypair.generate())).toThrow(/Refusing a raw agent keypair in production/);
  });

  test("allows a raw keypair in production with PRAXIS_ALLOW_LOCAL_AGENT_KEY=1", () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.PRAXIS_ALLOW_LOCAL_AGENT_KEY = "1";
    expect(resolveAgentSigner(Keypair.generate())).toBeInstanceOf(LocalKeypairSigner);
  });

  test("requireAgentSigner throws when nothing is configured", () => {
    expect(() => requireAgentSigner()).toThrow(/Configure the agent signer/);
  });
});

describe("resolveNextAgentPublicKey", () => {
  const KEY = "PRAXIS_NEXT_AGENT_PUBLIC_KEY";
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[KEY];
    Reflect.deleteProperty(process.env, KEY);
  });
  afterEach(() => {
    if (saved === undefined) Reflect.deleteProperty(process.env, KEY);
    else process.env[KEY] = saved;
  });

  test("prefers the env public key (remote custody)", () => {
    const pub = Keypair.generate().publicKey;
    process.env[KEY] = pub.toBase58();
    expect(resolveNextAgentPublicKey()?.equals(pub)).toBe(true);
  });

  test("falls back to the next keypair's public key", () => {
    const kp = Keypair.generate();
    expect(resolveNextAgentPublicKey(kp)?.equals(kp.publicKey)).toBe(true);
  });

  test("returns undefined when neither is set", () => {
    expect(resolveNextAgentPublicKey()).toBeUndefined();
  });
});
