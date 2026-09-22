import { readFileSync } from "node:fs";

import { Keypair } from "@solana/web3.js";

/**
 * Load a Solana keypair from a JSON secret-key file (e.g. `keys/agent.json`).
 *
 * Shared by the live-cluster scripts that sign as owner/agent
 * (`reenable-smoke`, `reenable-multicycle`, `policychange-smoke`) so the
 * file format stays one definition instead of three copies.
 */
export function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}
