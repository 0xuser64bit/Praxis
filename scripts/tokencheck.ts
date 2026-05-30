/**
 * Coverage for the SPL token-transfer wiring (roadmap #4 tail):
 *   A) the server-side token policy check (`checkTokenTransferPolicy`), and
 *   B) the mock provider's USDC send end-to-end (parse → token-envelope check →
 *      sign → independent token counter).
 *
 * The on-chain enforcement itself is proven by the Rust T7 gate; this proves the
 * off-chain mirror and the agent/UI wiring agree with it.
 *
 * Run: `bun scripts/tokencheck.ts`
 */

import type { AgentBlock, PolicyView, Thread, TokenInfo } from "@praxis/shared";
import { RejectReason } from "@praxis/shared";

import { checkTokenTransferPolicy } from "../server/agent/policy";
import { MockPraxisProvider } from "../components/app/mock/mockProvider";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const DEFAULT_MINT = "11111111111111111111111111111111";
const now = 1_900_000_000;

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`│   ✓ ${label}${detail ? `  ↳ ${detail}` : ""}`);
  else {
    failures++;
    console.log(`│   ✗ ${label}  ↳ FAILED ${detail}`);
  }
}

const usdc = (n: number): bigint => BigInt(n) * 1_000_000n;
const usdcToken: TokenInfo = { symbol: "USDC", mint: USDC_MINT, decimals: 6, verified: true };
const bonkToken: TokenInfo = { symbol: "BONK", mint: BONK_MINT, decimals: 5, verified: true };

function policy(overrides: Partial<PolicyView> = {}): PolicyView {
  return {
    address: "PoLicy1111111111111111111111111111111111111",
    owner: "Owner11111111111111111111111111111111111111",
    agentAuthority: "Agent11111111111111111111111111111111111111",
    maxPerTx: 50_000_000_000n,
    dailyLimit: 5_000_000_000n,
    spentToday: 0n,
    dayStartTs: now,
    allowedPrograms: [],
    allowedRecipients: [],
    allowedMints: [],
    expiryTs: now + 7 * 86_400,
    paused: false,
    vaultBalance: 6_000_000_000n,
    tokenMint: USDC_MINT,
    tokenMaxPerTx: usdc(200),
    tokenDailyLimit: usdc(500),
    tokenSpentToday: 0n,
    tokenDayStartTs: now,
    ...overrides,
  };
}

console.log("┌──── SPL TOKEN TRANSFER WIRING ─────────────────────────────────────────────");

console.log("│ A. server checkTokenTransferPolicy (mirrors agent_transfer_spl)");
{
  const within = checkTokenTransferPolicy(policy(), usdcToken, usdc(100), now);
  assert("100 USDC within caps → allowed", within.allowed === true);

  const perTx = checkTokenTransferPolicy(policy(), usdcToken, usdc(201), now);
  assert("201 USDC > 200 per-tx → OverPerTx", perTx.allowed === false && perTx.reasonCode === RejectReason.OverPerTx);

  const daily = checkTokenTransferPolicy(policy({ tokenSpentToday: usdc(400) }), usdcToken, usdc(150), now);
  assert("400 spent + 150 > 500 daily → OverDaily", daily.allowed === false && daily.reasonCode === RejectReason.OverDaily);

  const wrongMint = checkTokenTransferPolicy(policy(), bonkToken, usdc(1), now);
  assert("BONK (wrong mint) → MintNotAllowed", wrongMint.allowed === false && wrongMint.reasonCode === RejectReason.MintNotAllowed);

  const notConfigured = checkTokenTransferPolicy(policy({ tokenMint: DEFAULT_MINT }), usdcToken, usdc(1), now);
  assert("no token configured → blocked, no on-chain reasonCode", notConfigured.allowed === false && notConfigured.reasonCode === undefined);

  const paused = checkTokenTransferPolicy(policy({ paused: true }), usdcToken, usdc(1), now);
  assert("paused → Paused", paused.allowed === false && paused.reasonCode === RejectReason.Paused);

  const counter = checkTokenTransferPolicy(policy(), usdcToken, usdc(100), now);
  assert("token check reports the TOKEN envelope (500 daily)", counter.dailyLimit === usdc(500));
}

console.log("│ B. mock provider USDC send end-to-end (separate token counter)");

function latestAgentBlocks(p: MockPraxisProvider, threadId: string): AgentBlock[] {
  const thread = p.getThread(threadId) as Thread | undefined;
  if (!thread) return [];
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const m = thread.messages[i];
    if (m.role === "agent") return m.blocks;
  }
  return [];
}
function proposalFrom(p: MockPraxisProvider, blocks: AgentBlock[]) {
  const b = blocks.find((x) => x.type === "proposal");
  return b?.type === "proposal" ? p.getProposal(b.proposalId) : undefined;
}

async function mockPart() {
  // (1) Allowed USDC send, signs, debits the TOKEN counter (not the SOL one).
  const p = new MockPraxisProvider();
  const solBefore = p.getPolicy().spentToday;
  const r1 = await p.send(null, "send 100 usdc to maya");
  const prop = proposalFrom(p, latestAgentBlocks(p, r1.threadId));
  assert("USDC proposal created", Boolean(prop));
  assert("asset is USDC (6dp)", prop?.detail.kind === "transfer" && prop.detail.asset.symbol === "USDC" && prop.detail.asset.decimals === 6);
  assert("within token caps → allowed", prop?.check.allowed === true);
  if (prop) await p.signProposal(prop.id);
  assert("signed", p.getProposal(prop!.id)?.state === "signed");
  assert("token counter += 100 USDC", p.getPolicy().tokenSpentToday === usdc(100));
  assert("SOL counter untouched by USDC send", p.getPolicy().spentToday === solBefore);

  // (2) Over the per-tx cap (200) → blocked.
  const p2 = new MockPraxisProvider();
  const r2 = await p2.send(null, "send 250 usdc to maya");
  const over = proposalFrom(p2, latestAgentBlocks(p2, r2.threadId));
  assert("250 USDC > 200 per-tx → blocked OverPerTx", over?.check.allowed === false && over?.check.reasonCode === RejectReason.OverPerTx);

  // (3) A non-configured mint (BONK) → mint allow-list rejects.
  const p3 = new MockPraxisProvider();
  const r3 = await p3.send(null, "send 5 bonk to maya");
  const bonk = proposalFrom(p3, latestAgentBlocks(p3, r3.threadId));
  assert("BONK send → MintNotAllowed", bonk?.check.allowed === false && bonk?.check.reasonCode === RejectReason.MintNotAllowed);
}

async function dashboardPart() {
  console.log("│ C. dashboard configureToken reconfigures the token envelope (mock)");
  const jup = (n: number): bigint => BigInt(n) * 1_000_000n;
  const p = new MockPraxisProvider();

  // Seed configures USDC. The owner reconfigures the envelope to JUP.
  await p.configureToken({ tokenMint: JUP_MINT, tokenMaxPerTx: jup(50), tokenDailyLimit: jup(150) });
  const pol = p.getPolicy();
  assert("tokenMint → JUP", pol.tokenMint === JUP_MINT);
  assert("tokenMaxPerTx updated to 50 JUP", pol.tokenMaxPerTx === jup(50));
  assert("tokenDailyLimit updated to 150 JUP", pol.tokenDailyLimit === jup(150));
  assert("tokenSpentToday reset on configure", pol.tokenSpentToday === 0n);

  // USDC is no longer the configured mint → rejected; JUP within new caps → allowed.
  const rU = await p.send(null, "send 10 usdc to maya");
  const propU = proposalFrom(p, latestAgentBlocks(p, rU.threadId));
  assert("USDC now rejected (mint changed) → MintNotAllowed", propU?.check.allowed === false && propU?.check.reasonCode === RejectReason.MintNotAllowed);

  const rJ = await p.send(null, "send 40 jup to maya");
  const propJ = proposalFrom(p, latestAgentBlocks(p, rJ.threadId));
  assert("40 JUP within new caps → allowed", propJ?.check.allowed === true);
}

async function main() {
  await mockPart();
  await dashboardPart();
  console.log("└───────────────────────────────────────────────────────────────────────────");
  if (failures === 0) {
    console.log("\nTOKEN TRANSFER: PASS ✅");
    process.exit(0);
  }
  console.log(`\nTOKEN TRANSFER: FAIL ❌ — ${failures} assertion(s) failed.`);
  process.exit(1);
}

void main();
