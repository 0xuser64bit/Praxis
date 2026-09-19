import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Keypair } from "@solana/web3.js";
import type { PolicyView } from "@praxis/shared";

import { PraxisServerProvider } from "../praxisServer";
import type { AegisClient, TransferExecution, TransferSimulation } from "../../aegis/client";
import { DEFAULT_AEGIS_PROGRAM_ID } from "../../aegis/constants";
import { DEFAULT_PRESTOCKS_API_URL, DEFAULT_PRESTOCKS_TIMEOUT_MS, DEFAULT_TOKENS, type PraxisServerConfig } from "../../env";
import { findPolicyPda } from "../../aegis/pdas";
import { buildStockTokens } from "../../stocks/universe";
import { policyFixture } from "../../testing/fixtures";

let prevDir: string | undefined;
let prevIntent: string | undefined;

beforeAll(() => {
  prevDir = process.env.PRAXIS_STATE_DIR;
  prevIntent = process.env.PRAXIS_LOCAL_INTENT;
  process.env.PRAXIS_STATE_DIR = mkdtempSync(join(tmpdir(), "praxis-dca-"));
  process.env.PRAXIS_LOCAL_INTENT = "1";
});

afterAll(() => {
  if (prevDir === undefined) delete process.env.PRAXIS_STATE_DIR;
  else process.env.PRAXIS_STATE_DIR = prevDir;
  if (prevIntent === undefined) delete process.env.PRAXIS_LOCAL_INTENT;
  else process.env.PRAXIS_LOCAL_INTENT = prevIntent;
});

class FakeAegis {
  policy: PolicyView;
  simResult: TransferSimulation;
  execResult: TransferExecution;

  constructor(policy: PolicyView) {
    this.policy = policy;
    this.simResult = {
      check: { allowed: true, spentToday: 0n, dailyLimit: policy.dailyLimit, remaining: policy.dailyLimit },
      simulation: "Simulation passed",
      networkFee: 5000n,
      logs: [],
    };
    this.execResult = {
      sig: "sig-confirmed",
      check: { allowed: true, spentToday: 500_000_000n, dailyLimit: policy.dailyLimit, remaining: policy.dailyLimit },
      status: "confirmed",
      logs: [],
    };
  }

  async getPolicy() {
    return this.policy;
  }
  async getActionLog() {
    return [];
  }
  async simulateAgentTransfer() {
    return this.simResult;
  }
  async executeAgentTransfer() {
    return this.execResult;
  }
  async simulateAgentTransferSpl() {
    return this.simResult;
  }
  async executeAgentTransferSpl() {
    return this.execResult;
  }
}

const STOCK_TOKENS = buildStockTokens();

function makeConfig(over: Partial<PraxisServerConfig> = {}): PraxisServerConfig {
  const owner = Keypair.generate();
  const agent = Keypair.generate();
  return {
    rpcUrl: "http://127.0.0.1:8899",
    researchRpcUrl: "http://127.0.0.1:8899",
    commitment: "confirmed",
    programId: DEFAULT_AEGIS_PROGRAM_ID,
    ownerAddress: owner.publicKey,
    ownerKeypair: owner,
    agentKeypair: agent,
    policyAddress: findPolicyPda(owner.publicKey, DEFAULT_AEGIS_PROGRAM_ID),
    addressBook: [],
    tokens: [...DEFAULT_TOKENS, ...STOCK_TOKENS],
    stocksEnabled: true,
    prestocksApiUrl: DEFAULT_PRESTOCKS_API_URL,
    prestocksTimeoutMs: DEFAULT_PRESTOCKS_TIMEOUT_MS,
    stockUniverse: undefined,
    ...over,
  };
}

function build(policy = policyFixture()) {
  const config = makeConfig();
  const fake = new FakeAegis(policy);
  const provider = new PraxisServerProvider(config, fake as unknown as AegisClient);
  return { provider, fake, config };
}

function agentBlocks(provider: PraxisServerProvider, threadId: string) {
  const thread = provider.getThread(threadId)!;
  return thread.messages.filter((m) => m.role === "agent").flatMap((m) => m.blocks);
}

describe("DCA schedules", () => {
  test("a recurring buy stores a schedule and a notice (no proposal, no signature)", async () => {
    const { provider, config } = build();
    const { threadId } = await provider.send(null, "buy $50 openai every monday");

    const schedules = provider.getSchedules();
    expect(schedules).toHaveLength(1);
    expect(schedules[0].asset).toBe("OPENAI");
    expect(schedules[0].amount).toBe(50_000_000n);
    expect(schedules[0].recipientAddress).toBe(config.ownerAddress!.toBase58());
    expect(schedules[0].recipientName).toBe("you");
    expect(schedules[0].cadence).toEqual({ type: "weekly", weekday: 1 });
    expect(schedules[0].nextFireTs).toBeGreaterThan(Date.now());

    const blocks = agentBlocks(provider, threadId);
    expect(blocks.some((b) => b.type === "notice")).toBe(true);
    expect(blocks.some((b) => b.type === "proposal")).toBe(false);
    expect(Object.keys(provider.getAllProposals())).toHaveLength(0);
  });

  test("firing a due schedule emits one proposal through the same checks", async () => {
    const { provider } = build();
    await provider.send(null, "buy $50 openai every monday");
    const schedule = provider.getSchedules()[0];
    const firstFire = schedule.nextFireTs;

    const fired = await provider.fireDueSchedules(firstFire + 1);
    expect(fired).toHaveLength(1);
    expect(fired[0].scheduleId).toBe(schedule.id);
    expect(fired[0].allowed).toBe(true);

    const proposal = provider.getProposal(fired[0].proposalId)!;
    expect(proposal.detail.kind).toBe("transfer");
    if (proposal.detail.kind === "transfer") {
      expect(proposal.detail.asset.symbol).toBe("OPENAI");
      expect(proposal.detail.amount).toBe(50_000_000n);
    }
    expect(proposal.state).toBe("pending");
    // Advanced past the fire, and the creation thread carries the proposal.
    expect(provider.getSchedules()[0].nextFireTs).toBeGreaterThan(firstFire);
  });

  test("a far-past schedule fires once and skips ahead (no catch-up spiral)", async () => {
    const { provider } = build();
    await provider.send(null, "dca 10 openai daily");
    const fired = await provider.fireDueSchedules(Date.now() + 400 * 86_400_000);
    expect(fired).toHaveLength(1);
    expect(provider.getSchedules()[0].nextFireTs).toBeGreaterThan(Date.now());
  });

  test("nothing due fires nothing and writes nothing", async () => {
    const { provider } = build();
    await provider.send(null, "buy $50 openai every monday");
    expect(await provider.fireDueSchedules(Date.now())).toEqual([]);
  });

  test("cancelSchedule stops a schedule (idempotent on unknown ids)", async () => {
    const { provider } = build();
    await provider.send(null, "buy $50 openai every monday");
    const schedule = provider.getSchedules()[0];
    await provider.cancelSchedule(schedule.id);
    expect(provider.getSchedules()).toEqual([]);
    // A cancelled schedule never fires, and re-cancelling is a no-op.
    expect(await provider.fireDueSchedules(schedule.nextFireTs + 1)).toEqual([]);
    await provider.cancelSchedule(schedule.id);
    await provider.cancelSchedule("s-does-not-exist");
  });
});

describe("basket buys", () => {
  function stubPrices(provider: PraxisServerProvider) {
    provider.basketPriceSource = async () => new Map([["OPENAI", 10], ["ANTHROPIC", 20]]);
  }

  test("an allowed basket stores ordered per-constituent proposals", async () => {
    const { provider } = build();
    stubPrices(provider);
    const { threadId } = await provider.send(null, "buy ai basket $60");

    const blocks = agentBlocks(provider, threadId).filter((b) => b.type === "proposal");
    expect(blocks).toHaveLength(2);
    const proposals = blocks.map((b) => provider.getProposal((b as { proposalId: string }).proposalId)!);
    expect(proposals.map((p) => p.state)).toEqual(["pending", "pending"]);
    const amounts = new Map(
      proposals.map((p) => [
        p.detail.kind === "transfer" ? p.detail.asset.symbol : "?",
        p.detail.kind === "transfer" ? p.detail.amount : 0n,
      ]),
    );
    // $30 per share: 3 OPENAI @ $10, 1.5 ANTHROPIC @ $20 (6 decimals).
    expect(amounts.get("OPENAI")).toBe(3_000_000n);
    expect(amounts.get("ANTHROPIC")).toBe(1_500_000n);
  });

  test("a blocked constituent voids the whole basket (all-or-clarify)", async () => {
    const { provider, fake } = build();
    stubPrices(provider);
    fake.simResult = {
      check: { allowed: false, reason: "over the daily limit", spentToday: 0n, dailyLimit: 1n, remaining: 0n },
      simulation: "Would be rejected by Aegis",
      networkFee: 5000n,
      logs: [],
    };
    const activityBefore = provider.getActivity().length;
    const { threadId } = await provider.send(null, "buy ai basket $60");

    const blocks = agentBlocks(provider, threadId);
    expect(blocks.some((b) => b.type === "proposal")).toBe(false);
    expect(blocks.some((b) => b.type === "clarify")).toBe(true);
    expect(Object.keys(provider.getAllProposals())).toHaveLength(0);
    expect(provider.getActivity()).toHaveLength(activityBefore);
  });

  test("unpriceable constituents clarify without storing", async () => {
    const { provider } = build();
    provider.basketPriceSource = async () => new Map();
    const { threadId } = await provider.send(null, "buy ai basket $60");
    const blocks = agentBlocks(provider, threadId);
    expect(blocks.some((b) => b.type === "clarify")).toBe(true);
    expect(Object.keys(provider.getAllProposals())).toHaveLength(0);
  });
});
