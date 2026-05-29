/**
 * Unit checks for the server-side agent-layer swap allow-list (`checkSwapPolicy`).
 *
 * This is the API-mode half of demo §9 #3 ("the allow-list holds"): the server
 * must reject an unverified-mint swap with the SAME verdict the mock shows.
 * Pure function, no chain needed.
 *
 * Run: `bun scripts/swapcheck.ts`
 */

import type { PolicyView, TokenInfo } from "@praxis/shared";

import { JUPITER_PROGRAM_ID, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../server/aegis/constants";
import { checkSwapPolicy } from "../server/agent/policy";

const JUP = JUPITER_PROGRAM_ID.toBase58();
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SCAM_MINT = "5c4mC01nUnverif1edM1ntAddre55555555555555555";
const now = 1_900_000_000;

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`│   ✓ ${label}${detail ? `  ↳ ${detail}` : ""}`);
  else {
    failures++;
    console.log(`│   ✗ ${label}  ↳ FAILED ${detail}`);
  }
}

function policy(overrides: Partial<PolicyView> = {}): PolicyView {
  return {
    address: "PoLicy1111111111111111111111111111111111111",
    owner: "Owner11111111111111111111111111111111111111",
    agentAuthority: "Agent11111111111111111111111111111111111111",
    maxPerTx: 50_000_000_000n,
    dailyLimit: 5_000_000_000n,
    spentToday: 0n,
    dayStartTs: now,
    allowedPrograms: [SYSTEM_PROGRAM_ID.toBase58(), TOKEN_PROGRAM_ID.toBase58(), JUP],
    allowedRecipients: [],
    allowedMints: [USDC_MINT],
    expiryTs: now + 7 * 86_400,
    paused: false,
    vaultBalance: 6_000_000_000n,
    ...overrides,
  };
}

const usdc: TokenInfo = { symbol: "USDC", mint: USDC_MINT, decimals: 6, verified: true };
const scam: TokenInfo = { symbol: "SCAMCOIN", mint: SCAM_MINT, decimals: 6, verified: false };

console.log("┌──── SERVER SWAP ALLOW-LIST CHECK (demo §9 #3, API mode) ───────────────────");

console.log("│ C1  Unverified mint → rejected by mint allow-list");
{
  const r = checkSwapPolicy(policy(), scam, JUP, now);
  assert("not allowed", r.allowed === false);
  assert("reason cites verified-mint allow-list", /verified-mint allow-list/i.test(r.reason ?? ""), r.reason ?? "");
  assert("NO on-chain reasonCode (agent-layer verdict)", r.reasonCode === undefined);
}

console.log("│ C2  Verified mint + Jupiter allowed → policy permits");
{
  const r = checkSwapPolicy(policy(), usdc, JUP, now);
  assert("allowed", r.allowed === true);
  assert("no reason on allow", r.reason === undefined);
}

console.log("│ C3  Jupiter NOT allow-listed → program check rejects first");
{
  const r = checkSwapPolicy(policy({ allowedPrograms: [SYSTEM_PROGRAM_ID.toBase58()] }), usdc, JUP, now);
  assert("not allowed", r.allowed === false);
  assert("reason cites allowed-program list", /allowed-program/i.test(r.reason ?? ""), r.reason ?? "");
}

console.log("│ C4  Paused policy → rejected before allow-lists");
{
  const r = checkSwapPolicy(policy({ paused: true }), scam, JUP, now);
  assert("not allowed", r.allowed === false);
  assert("reason cites paused/revoked", /paused|revoked/i.test(r.reason ?? ""), r.reason ?? "");
}

console.log("└───────────────────────────────────────────────────────────────────────────");
if (failures === 0) {
  console.log("\nSWAP ALLOW-LIST: PASS ✅");
  process.exit(0);
}
console.log(`\nSWAP ALLOW-LIST: FAIL ❌ — ${failures} assertion(s) failed.`);
process.exit(1);
