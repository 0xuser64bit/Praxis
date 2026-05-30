import { readFileSync } from "node:fs";

import bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";

import { DEFAULT_AEGIS_PROGRAM_ID } from "../server/aegis/constants";
import { createSignerHandler } from "./handler";

function loadKeypair(): Keypair {
  const path = process.env.SIGNER_AGENT_KEYPAIR_PATH?.trim();
  const raw = path ? readFileSync(path, "utf8") : process.env.SIGNER_AGENT_KEYPAIR?.trim();
  if (!raw) {
    throw new Error("Set SIGNER_AGENT_KEYPAIR or SIGNER_AGENT_KEYPAIR_PATH to the agent keypair.");
  }
  const trimmed = raw.trim();
  const secret = trimmed.startsWith("[")
    ? Uint8Array.from(JSON.parse(trimmed) as number[])
    : bs58.decode(trimmed);
  return Keypair.fromSecretKey(secret);
}

const token = process.env.SIGNER_TOKEN?.trim();
if (!token) {
  throw new Error("Set SIGNER_TOKEN to the bearer token the Praxis app will present.");
}

const keypair = loadKeypair();
const programId = new PublicKey(
  process.env.SIGNER_AEGIS_PROGRAM_ID?.trim() || DEFAULT_AEGIS_PROGRAM_ID.toBase58(),
);
const port = Number(process.env.SIGNER_PORT ?? 8787);

const handle = createSignerHandler({ keypair, programId, token });

Bun.serve({ port, fetch: handle });

console.log(
  `praxis signer listening on :${port} — agent ${keypair.publicKey.toBase58()}, program ${programId.toBase58()}`,
);
