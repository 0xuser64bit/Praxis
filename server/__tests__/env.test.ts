import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
  assertSharedAgentKeySafe,
  configForWalletOwner,
  getServerConfig,
  requireAgentKeypair,
  requireNextAgentKeypair,
  requirePolicyAddress,
  resetConfigForTests,
  validatePublicKey,
  type PraxisServerConfig,
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
  "PRAXIS_ALLOW_DEMO_DATA",
  "PRAXIS_TOKENS",
  "SOLANA_COMMITMENT",
  "NODE_ENV",
  "PRAXIS_ALLOW_SHARED_AGENT_KEY",
  "PRAXIS_AGENT_SIGNER_URL",
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

  test("does not load demo contacts by default in production", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    resetConfigForTests();
    expect(getServerConfig().addressBook).toEqual([]);

    process.env.PRAXIS_ALLOW_DEMO_DATA = "1";
    resetConfigForTests();
    expect(getServerConfig().addressBook.length).toBeGreaterThan(0);
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

describe("assertSharedAgentKeySafe", () => {
  const configuredOwner = Keypair.generate();
  const stranger = Keypair.generate().publicKey.toBase58();
  // Only `agentKeypair` and `ownerAddress` are read by the guard.
  const base = {
    agentKeypair: Keypair.generate(),
    ownerAddress: configuredOwner.publicKey,
  } as unknown as PraxisServerConfig;

  const setProd = () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  };

  test("allows any wallet outside production", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    expect(() => assertSharedAgentKeySafe(stranger, base)).not.toThrow();
  });

  test("refuses a second wallet under a shared key in production", () => {
    setProd();
    expect(() => assertSharedAgentKeySafe(stranger, base)).toThrow(/shared agent key in production/);
  });

  test("allows the single configured owner in production", () => {
    setProd();
    expect(() => assertSharedAgentKeySafe(configuredOwner.publicKey.toBase58(), base)).not.toThrow();
  });

  test("allows any wallet when the shared-key model is explicitly acknowledged", () => {
    setProd();
    process.env.PRAXIS_ALLOW_SHARED_AGENT_KEY = "1";
    expect(() => assertSharedAgentKeySafe(stranger, base)).not.toThrow();
  });

  test("allows any wallet under remote agent custody", () => {
    setProd();
    process.env.PRAXIS_AGENT_SIGNER_URL = "https://signer.example";
    expect(() => assertSharedAgentKeySafe(stranger, base)).not.toThrow();
  });

  test("allows any wallet when no shared agent key is configured", () => {
    setProd();
    const keyless = { ownerAddress: configuredOwner.publicKey } as unknown as PraxisServerConfig;
    expect(() => assertSharedAgentKeySafe(stranger, keyless)).not.toThrow();
  });
});
