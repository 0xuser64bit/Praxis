/**
 * Headless smoke test for the agent kill-switch + re-enable flow (Aegis).
 *
 * Exercises the exact server signing path the UI uses:
 *   1. bootstrap a policy (owner-signed) and fund the vault
 *   2. baseline agent transfer  -> CONFIRMED, signed by the current agent key
 *   3. revoke the agent         -> next transfer REJECTED (authority zeroed)
 *   4. rotate / re-enable        -> next transfer CONFIRMED, signed by the NEXT
 *      key, proving AegisClient.activeAgentSigner() follows the on-chain
 *      agent_authority after rotation (the bug this verifies).
 *
 * Run against a local validator:
 *   SOLANA_RPC_URL=http://127.0.0.1:8899 bun scripts/reenable-smoke.ts
 *
 * Keypairs default to the localnet test set; override with SMOKE_OWNER /
 * SMOKE_AGENT / SMOKE_NEXT_AGENT.
 */

import { readFileSync } from "node:fs";

import { Keypair } from "@solana/web3.js";

import { AegisClient } from "../server/aegis/client";
import { findPolicyPda } from "../server/aegis/pdas";
import { getServerConfig, resetConfigForTests, type PraxisServerConfig } from "../server/env";
import { PraxisNotFoundError } from "../server/errors";
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
  resetConfigForTests();
  const base = getServerConfig();
  const ownerKeypair = loadKeypair(OWNER);
  const agentKeypair = loadKeypair(AGENT);
  const nextAgentKeypair = loadKeypair(NEXT);

  // resolveNextAgentPublicKey() reads this env first; pin it to our local next
  // key so rotate registers a key we actually hold.
  process.env.PRAXIS_NEXT_AGENT_PUBLIC_KEY = nextAgentKeypair.publicKey.toBase58();
  delete process.env.PRAXIS_AGENT_SIGNER_URL;

  const config: PraxisServerConfig = {
    ...base,
    ownerKeypair,
    ownerAddress: ownerKeypair.publicKey,
    agentKeypair,
    nextAgentKeypair,
    policyAddress: findPolicyPda(ownerKeypair.publicKey, base.programId),
  };

  console.log(`RPC          ${config.rpcUrl}`);
  console.log(`program      ${config.programId.toBase58()}`);
  console.log(`owner        ${ownerKeypair.publicKey.toBase58()}`);
  console.log(`agent  (cur) ${agentKeypair.publicKey.toBase58()}`);
  console.log(`agent (next) ${nextAgentKeypair.publicKey.toBase58()}\n`);

  const client = new AegisClient(config);
  const recipient = Keypair.generate().publicKey;
  const amount = parseHumanUnits("0.05", SOL_DECIMALS);

  // 1. bootstrap (idempotent on a fresh validator)
  try {
    await client.getPolicy();
    console.log("policy already exists — reusing\n");
  } catch (error) {
    if (!(error instanceof PraxisNotFoundError)) throw error;
    await client.bootstrapPolicy(parseHumanUnits("2", SOL_DECIMALS));
    console.log("bootstrapped policy + funded vault 2 SOL\n");
  }

  const authority = async () => (await client.getPolicy()).agentAuthority;
  const tryTransfer = async (skipPreflight: boolean) => {
    try {
      const exec = await client.executeAgentTransfer(recipient, amount, { skipPreflight });
      return { confirmed: exec.status === "confirmed", reason: exec.check.reason };
    } catch (error) {
      return { confirmed: false, reason: error instanceof Error ? error.message : "threw" };
    }
  };

  // 2. baseline
  check("authority starts as the current agent key", (await authority()) === agentKeypair.publicKey.toBase58());
  const baseline = await tryTransfer(false);
  check("baseline agent transfer is CONFIRMED", baseline.confirmed, baseline.reason ?? "");

  // 3. revoke -> rejected
  await client.revokeAgent();
  check("authority zeroed after revoke", (await authority()) === "11111111111111111111111111111111");
  const afterRevoke = await tryTransfer(true);
  check("transfer is REJECTED while revoked", !afterRevoke.confirmed, afterRevoke.reason ?? "");

  // 4. re-enable via rotate -> next key authorized, transfer confirmed again
  await client.rotateAgent();
  check("authority becomes the NEXT agent key after re-enable", (await authority()) === nextAgentKeypair.publicKey.toBase58());
  const afterRotate = await tryTransfer(false);
  check("transfer is CONFIRMED again after re-enable (signed by next key)", afterRotate.confirmed, afterRotate.reason ?? "");

  const policy = await client.getPolicy();
  console.log(`\nvault balance: ${formatSol(policy.vaultBalance)} SOL`);
  console.log(failures === 0 ? "\n🎉 ALL CHECKS PASSED" : `\n💥 ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("smoke test crashed:", error);
  process.exit(1);
});
