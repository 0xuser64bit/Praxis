/**
 * Proves revoke → re-enable can run an unbounded number of times with the fixed
 * current/next agent key pair (the question: "is it only one revoke + one
 * re-enable?"). Runs N cycles against a fresh policy, asserting each cycle:
 *   revoke -> transfer REJECTED ; re-enable -> authority == next ; transfer CONFIRMED.
 *
 * SOLANA_RPC_URL=http://127.0.0.1:8899 SMOKE_NEXT_AGENT=keys/next-agent.json \
 *   CYCLES=3 bun scripts/reenable-multicycle.ts
 */

import { readFileSync } from "node:fs";

import { Keypair } from "@solana/web3.js";

import { AegisClient } from "../server/aegis/client";
import { findPolicyPda } from "../server/aegis/pdas";
import { getServerConfig, resetConfigForTests, type PraxisServerConfig } from "../server/env";
import { PraxisNotFoundError } from "../server/errors";
import { parseHumanUnits, SOL_DECIMALS } from "../server/units";

const OWNER = process.env.SMOKE_OWNER ?? "/tmp/praxis-localtest/owner.json";
const AGENT = process.env.SMOKE_AGENT ?? "keys/agent.json";
const NEXT = process.env.SMOKE_NEXT_AGENT ?? "keys/next-agent.json";
const CYCLES = Number(process.env.CYCLES ?? "3");
const ZERO = "11111111111111111111111111111111";

const loadKeypair = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  resetConfigForTests();
  const base = getServerConfig();
  const ownerKeypair = loadKeypair(OWNER);
  const nextAgentKeypair = loadKeypair(NEXT);
  const config: PraxisServerConfig = {
    ...base,
    ownerKeypair,
    ownerAddress: ownerKeypair.publicKey,
    agentKeypair: loadKeypair(AGENT),
    nextAgentKeypair,
    policyAddress: findPolicyPda(ownerKeypair.publicKey, base.programId),
  };
  process.env.PRAXIS_NEXT_AGENT_PUBLIC_KEY = nextAgentKeypair.publicKey.toBase58();
  delete process.env.PRAXIS_AGENT_SIGNER_URL;

  const client = new AegisClient(config);
  const recipient = Keypair.generate().publicKey;
  const amount = parseHumanUnits("0.02", SOL_DECIMALS);
  const authority = async () => (await client.getPolicy()).agentAuthority;
  const tryTransfer = async (skipPreflight: boolean) => {
    try {
      return (await client.executeAgentTransfer(recipient, amount, { skipPreflight })).status === "confirmed";
    } catch {
      return false;
    }
  };

  try {
    await client.getPolicy();
  } catch (error) {
    if (!(error instanceof PraxisNotFoundError)) throw error;
    await client.bootstrapPolicy(parseHumanUnits("5", SOL_DECIMALS));
  }

  check("baseline transfer CONFIRMED", await tryTransfer(false));

  for (let i = 1; i <= CYCLES; i++) {
    console.log(`\n--- cycle ${i}/${CYCLES} ---`);
    await client.revokeAgent();
    check(`[${i}] authority zeroed on revoke`, (await authority()) === ZERO);
    check(`[${i}] transfer REJECTED while revoked`, !(await tryTransfer(true)));
    await client.rotateAgent();
    check(`[${i}] authority = next key on re-enable`, (await authority()) === nextAgentKeypair.publicKey.toBase58());
    check(`[${i}] transfer CONFIRMED after re-enable`, await tryTransfer(false));
  }

  console.log(failures === 0 ? `\n🎉 ${CYCLES} CYCLES — ALL PASSED (unlimited revoke/re-enable works)` : `\n💥 ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("crashed:", e); process.exit(1); });
