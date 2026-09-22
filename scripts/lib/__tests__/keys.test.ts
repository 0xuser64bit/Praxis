import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Keypair } from "@solana/web3.js";

import { loadKeypair } from "../keys";

describe("scripts/lib/keys", () => {
  test("loadKeypair round-trips a JSON secret-key file", () => {
    const keypair = Keypair.generate();
    const dir = mkdtempSync(join(tmpdir(), "praxis-keys-"));
    const path = join(dir, "agent.json");
    writeFileSync(path, JSON.stringify(Array.from(keypair.secretKey)));

    const loaded = loadKeypair(path);
    expect(loaded.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
  });

  test("loadKeypair throws on a missing file", () => {
    expect(() => loadKeypair(join(tmpdir(), "praxis-keys-nope", "missing.json"))).toThrow();
  });
});
