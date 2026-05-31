/**
 * Headless smoke test for chat-driven policy changes (Aegis).
 *
 * Drives the real PraxisServerProvider.send() path with the deterministic intent
 * parser (PRAXIS_LOCAL_INTENT=1) and a backend owner key present, so the
 * "apply immediately" branch runs and mutates the policy on-chain. Verifies:
 *   - the agent reply is a `policy_change` block marked applied
 *   - the on-chain daily limit actually changed
 *
 * Run against a local validator with a bootstrapped policy:
 *   SOLANA_RPC_URL=http://127.0.0.1:8899 PRAXIS_LOCAL_INTENT=1 \
 *     bun scripts/policychange-smoke.ts
 */

import { readFileSync } from "node:fs";

import { Keypair } from "@solana/web3.js";

import { AegisClient } from "../server/aegis/client";
import { findPolicyPda } from "../server/aegis/pdas";
import { getServerConfig, resetConfigForTests, type PraxisServerConfig } from "../server/env";
import { PraxisNotFoundError } from "../server/errors";
import { PraxisServerProvider } from "../server/provider/praxisServer";
import { formatSol, parseHumanUnits, SOL_DECIMALS } from "../server/units";

const OWNER = process.env.SMOKE_OWNER ?? "/tmp/praxis-localtest/owner.json";
const AGENT = process.env.SMOKE_AGENT ?? "keys/agent.json";
const NEXT = process.env.SMOKE_NEXT_AGENT ?? "/tmp/praxis-localtest/next-agent.json";

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  process.env.PRAXIS_LOCAL_INTENT = "1";
  resetConfigForTests();
  const base = getServerConfig();
  const ownerKeypair = loadKeypair(OWNER);
  const config: PraxisServerConfig = {
    ...base,
    ownerKeypair,
    ownerAddress: ownerKeypair.publicKey,
    agentKeypair: loadKeypair(AGENT),
    nextAgentKeypair: loadKeypair(NEXT),
    policyAddress: findPolicyPda(ownerKeypair.publicKey, base.programId),
  };
  process.env.PRAXIS_NEXT_AGENT_PUBLIC_KEY = config.nextAgentKeypair!.publicKey.toBase58();
  delete process.env.PRAXIS_AGENT_SIGNER_URL;

  const client = new AegisClient(config);
  try {
    await client.getPolicy();
  } catch (error) {
    if (!(error instanceof PraxisNotFoundError)) throw error;
    await client.bootstrapPolicy(parseHumanUnits("2", SOL_DECIMALS));
  }

  const before = (await client.getPolicy()).dailyLimit;
  console.log(`daily limit before: ${formatSol(before)} SOL`);

  const provider = new PraxisServerProvider(config, client);
  const tid = provider.newThread();
  await provider.send(tid, "change my daily limit to 10 SOL");

  // Inspect the agent reply block.
  const thread = provider.getThread(tid)!;
  const reply = thread.messages.at(-1)!;
  const block = reply.role === "agent" ? reply.blocks.at(-1) : undefined;
  if (block?.type !== "policy_change") console.log("unexpected reply block:", block?.type, block && "text" in block ? block.text : "");
  check("reply is a policy_change block", block?.type === "policy_change");
  check("block is marked applied", block?.type === "policy_change" && block.applied === true);

  // Confirm the change landed on-chain (fresh read).
  const after = (await new AegisClient(config).getPolicy()).dailyLimit;
  console.log(`daily limit after:  ${formatSol(after)} SOL`);
  check("on-chain daily limit is now 10 SOL", after === parseHumanUnits("10", SOL_DECIMALS), `${formatSol(after)} SOL`);

  console.log(failures === 0 ? "\n🎉 ALL CHECKS PASSED" : `\n💥 ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("smoke test crashed:", error);
  process.exit(1);
});
