/**
 * Money-shot regression harness (spec §9).
 *
 * Drives the MockPraxisProvider — the demo's backend — through the five
 * non-negotiable demo moments and asserts each still behaves. This is the
 * executable record of "the five money-shots still walk": run it before and
 * after every change to confirm the demo path is intact.
 *
 *   1. It works            — "send 0.5 sol to maya" → resolved, within-limit, signs
 *   2. The chain says no    — "send 50 sol to maya" → daily-limit rejection
 *   3. The allow-list holds  — swap into an unverified mint → policy rejects
 *   4. The kill switch       — revoke → the next agent action fails
 *   5. Read-only flourish    — "what's bonk doing" → distilled data, no advice
 *
 * Run: `bun scripts/moneyshots.ts`
 *
 * NOTE: this exercises the provider logic behind each money-shot (parse →
 * proposal → Aegis check → sign → activity), not pixel rendering. It is the
 * substance of the demo; the UI renders these same provider snapshots.
 */

import { RejectReason, type AgentBlock, type Thread } from "@praxis/shared";

import { MockPraxisProvider } from "../components/app/mock/mockProvider";

let failures = 0;

function assert(label: string, cond: boolean, detail = ""): boolean {
  if (cond) {
    console.log(`│   ✓ ${label}${detail ? `  ↳ ${detail}` : ""}`);
  } else {
    failures++;
    console.log(`│   ✗ ${label}  ↳ FAILED ${detail}`);
  }
  return cond;
}

/** Latest agent reply's blocks on a thread. */
function latestAgentBlocks(provider: MockPraxisProvider, threadId: string): AgentBlock[] {
  const thread = provider.getThread(threadId) as Thread | undefined;
  if (!thread) return [];
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const m = thread.messages[i];
    if (m.role === "agent") return m.blocks;
  }
  return [];
}

function proposalFromBlocks(provider: MockPraxisProvider, blocks: AgentBlock[]) {
  const block = blocks.find((b) => b.type === "proposal");
  if (block?.type !== "proposal") return undefined;
  return provider.getProposal(block.proposalId);
}

async function ms1_itWorks() {
  console.log("│ MS1  It works (send within limit)");
  const p = new MockPraxisProvider();
  const { threadId } = await p.send(null, "send 0.5 sol to maya");
  const proposal = proposalFromBlocks(p, latestAgentBlocks(p, threadId));
  assert("proposal created", Boolean(proposal), proposal?.id ?? "none");
  if (!proposal) return;
  assert("resolved Maya", proposal.detail.kind === "transfer" && proposal.detail.recipientName === "Maya Patel");
  assert("check allowed", proposal.check.allowed === true);
  assert("state pending", proposal.state === "pending");

  const vaultBefore = p.getPolicy().vaultBalance;
  await p.signProposal(proposal.id);
  const signed = p.getProposal(proposal.id)!;
  assert("state signed after sign", signed.state === "signed", signed.state);
  assert("spent_today += 0.5 SOL", p.getPolicy().spentToday === 500_000_000n, p.getPolicy().spentToday.toString());
  assert("vault debited", p.getPolicy().vaultBalance === vaultBefore - 500_000_000n);
  const latest = p.getActivity()[0];
  assert("activity logged allowed", latest.result === "allowed" && latest.label === "Maya Patel");
}

async function ms2_chainSaysNo() {
  console.log("│ MS2  The chain says no (over daily limit)");
  const p = new MockPraxisProvider();
  const { threadId } = await p.send(null, "send 50 sol to maya");
  const proposal = proposalFromBlocks(p, latestAgentBlocks(p, threadId));
  assert("proposal created", Boolean(proposal));
  if (!proposal) return;
  assert("check NOT allowed", proposal.check.allowed === false);
  assert("reason is OverDaily", proposal.check.reasonCode === RejectReason.OverDaily, String(proposal.check.reasonCode));
  assert("proposal blocked", proposal.state === "blocked");
  const latest = p.getActivity()[0];
  assert("rejection logged at parse time", latest.result === "rejected" && latest.reasonCode === RejectReason.OverDaily);
}

async function ms3_allowListHolds() {
  console.log("│ MS3  The allow-list holds (unverified mint)");
  const p = new MockPraxisProvider();
  const { threadId } = await p.send(null, "swap 100 usdc for scamcoin");
  const proposal = proposalFromBlocks(p, latestAgentBlocks(p, threadId));
  assert("swap proposal created", Boolean(proposal));
  if (!proposal) return;
  assert("is a swap", proposal.detail.kind === "swap");
  assert("check NOT allowed", proposal.check.allowed === false);
  assert(
    "reason cites verified-mint allow-list",
    /allow-list/i.test(proposal.check.reason ?? ""),
    proposal.check.reason ?? "",
  );
  assert("proposal blocked", proposal.state === "blocked");
}

async function ms4_killSwitch() {
  console.log("│ MS4  The kill switch (revoke → next action fails)");
  const p = new MockPraxisProvider();
  // Pre-revoke: a normal send is allowed.
  const first = await p.send(null, "send 0.5 sol to maya");
  const before = proposalFromBlocks(p, latestAgentBlocks(p, first.threadId));
  assert("pre-revoke send allowed", before?.check.allowed === true);

  await p.revokeAgent();
  assert("policy paused after revoke", p.getPolicy().paused === true);
  assert("agent authority zeroed", p.getPolicy().agentAuthority === "11111111111111111111111111111111");

  const second = await p.send(first.threadId, "send 0.5 sol to maya");
  const after = proposalFromBlocks(p, latestAgentBlocks(p, second.threadId));
  assert("post-revoke send rejected", after?.check.allowed === false);
  assert("reason is Paused", after?.check.reasonCode === RejectReason.Paused, String(after?.check.reasonCode));
}

async function ms5_readonly() {
  console.log("│ MS5  Read-only flourish (research, no advice)");
  const p = new MockPraxisProvider();
  const { threadId } = await p.send(null, "what's bonk doing this week");
  const blocks = latestAgentBlocks(p, threadId);
  const research = blocks.find((b) => b.type === "research");
  assert("research block returned", research?.type === "research");
  if (research?.type !== "research") return;
  assert("token is BONK", research.data.token === "BONK");
  assert(
    "explicit no-advice disclaimer",
    /buy, sell, or hold/i.test(research.text) || /data only/i.test(research.text),
    research.text,
  );
}

async function main() {
  console.log("┌──── PRAXIS MONEY-SHOT WALK (spec §9) ─────────────────────────────────────");
  await ms1_itWorks();
  await ms2_chainSaysNo();
  await ms3_allowListHolds();
  await ms4_killSwitch();
  await ms5_readonly();
  console.log("└───────────────────────────────────────────────────────────────────────────");

  if (failures === 0) {
    console.log("\nMONEY-SHOTS: PASS ✅ — all five demo moments walk.");
    process.exit(0);
  }
  console.log(`\nMONEY-SHOTS: FAIL ❌ — ${failures} assertion(s) failed.`);
  process.exit(1);
}

void main();
