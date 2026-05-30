import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
  configForWalletOwner,
  getServerConfig,
  requireAgentKeypair,
  requireNextAgentKeypair,
  requirePolicyAddress,
  resetConfigForTests,
  validatePublicKey,
} from "../env";
import { findPolicyPda } from "../aegis/pdas";

const ENV_KEYS = [
  "AEGIS_PROGRAM_ID",
  "AEGIS_OWNER_ADDRESS",
  "AEGIS_POLICY_ADDRESS",
  "PRAXIS_AGENT_KEYPAIR",
  "PRAXIS_AGENT_KEYPAIR_PATH",
  "PRAXIS_OWNER_KEYPAIR",
  "PRAXIS_OWNER_KEYPAIR_PATH",
  "PRAXIS_NEXT_AGENT_KEYPAIR",
  "PRAXIS_NEXT_AGENT_KEYPAIR_PATH",
  "PRAXIS_ADDRESS_BOOK",
  "PRAXIS_TOKENS",
  "SOLANA_COMMITMENT",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  resetConfigForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetConfigForTests();
});

describe("validatePublicKey", () => {
  test("accepts a valid key and rejects garbage", () => {
    const key = Keypair.generate().publicKey.toBase58();
    expect(validatePublicKey(key).toBase58()).toBe(key);
    expect(() => validatePublicKey("not-a-key")).toThrow(/valid Solana public key/);
  });
});

describe("getServerConfig", () => {
  test("defaults commitment to confirmed", () => {
    expect(getServerConfig().commitment).toBe("confirmed");
  });

  test("parses a JSON keypair from env", () => {
    const kp = Keypair.generate();
    process.env.PRAXIS_AGENT_KEYPAIR = JSON.stringify([...kp.secretKey]);
    resetConfigForTests();
    expect(requireAgentKeypair().publicKey.equals(kp.publicKey)).toBe(true);
  });

  test("rejects an invalid program id", () => {
    process.env.AEGIS_PROGRAM_ID = "nonsense";
    resetConfigForTests();
    expect(() => getServerConfig()).toThrow(/valid Solana public key/);
  });

  test("parses a custom address book and rejects a bad entry", () => {
    const addr = Keypair.generate().publicKey.toBase58();
    process.env.PRAXIS_ADDRESS_BOOK = JSON.stringify([{ label: "Bob", name: "Bob", address: addr }]);
    resetConfigForTests();
    expect(getServerConfig().addressBook[0]).toMatchObject({ label: "bob", name: "Bob", address: addr });

    process.env.PRAXIS_ADDRESS_BOOK = JSON.stringify([{ label: "x", name: "x", address: "bad" }]);
    resetConfigForTests();
    expect(() => getServerConfig()).toThrow();
  });

  test("rejects a token with out-of-range decimals", () => {
    const mint = Keypair.generate().publicKey.toBase58();
    process.env.PRAXIS_TOKENS = JSON.stringify([{ symbol: "X", mint, decimals: 99 }]);
    resetConfigForTests();
    expect(() => getServerConfig()).toThrow(/decimals must be an integer/);
  });

  test("requirePolicyAddress throws when no owner or policy is configured", () => {
    expect(() => requirePolicyAddress(getServerConfig())).toThrow(/locate the Aegis policy PDA/);
  });

  test("derives the policy PDA from a configured owner address", () => {
    const owner = Keypair.generate().publicKey.toBase58();
    process.env.AEGIS_OWNER_ADDRESS = owner;
    resetConfigForTests();
    const config = getServerConfig();
    const expected = findPolicyPda(new PublicKey(owner), config.programId);
    expect(requirePolicyAddress(config).equals(expected)).toBe(true);
  });

  test("requireNextAgentKeypair throws a helpful error when unset", () => {
    expect(() => requireNextAgentKeypair(getServerConfig())).toThrow(/Refusing to re-enable/);
  });
});

describe("configForWalletOwner", () => {
  test("scopes the policy PDA to the signed-in wallet", () => {
    const wallet = Keypair.generate().publicKey;
    const base = getServerConfig();
    const scoped = configForWalletOwner(wallet, base);
    expect(scoped.ownerAddress?.equals(wallet)).toBe(true);
    expect(scoped.policyAddress?.equals(findPolicyPda(wallet, base.programId))).toBe(true);
  });
});
