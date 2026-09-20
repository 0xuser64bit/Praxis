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
import { STOCK_SYMBOLS, buildStockTokens } from "../../stocks/universe";
import { policyFixture } from "../../testing/fixtures";

let prevDir: string | undefined;
let prevIntent: string | undefined;
let prevAllowMints: string | undefined;

beforeAll(() => {
  prevDir = process.env.PRAXIS_STATE_DIR;
  prevIntent = process.env.PRAXIS_LOCAL_INTENT;
  prevAllowMints = process.env.PRAXIS_ALLOW_UNVERIFIED_MINTS;
  process.env.PRAXIS_STATE_DIR = mkdtempSync(join(tmpdir(), "praxis-dca-"));
  process.env.PRAXIS_LOCAL_INTENT = "1";
  // These tests exercise DCA/basket mechanics, not mint verification: there is
  // no cluster here, so the movability check would refuse everything. The
  // refusal itself is covered by its own suite below.
  process.env.PRAXIS_ALLOW_UNVERIFIED_MINTS = "1";
});

afterAll(() => {
  if (prevAllowMints === undefined) delete process.env.PRAXIS_ALLOW_UNVERIFIED_MINTS;
  else process.env.PRAXIS_ALLOW_UNVERIFIED_MINTS = prevAllowMints;
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

/**
 * Confirmed decimals for the stock universe. Stock mints carry a placeholder
 * scale until it is verified, and the provider refuses amount math against an
 * unverified one — so a test that exercises buys has to supply the confirmed
 * values, exactly as an operator would via `PRAXIS_STOCK_DECIMALS`.
 */
const STOCK_DECIMALS: Record<string, number> = Object.fromEntries(
  STOCK_SYMBOLS.map((symbol) => [symbol, 9]),
);
const STOCK_TOKENS = buildStockTokens(STOCK_DECIMALS);

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
    stockDecimals: STOCK_DECIMALS,
    stockMints: {},
    scheduleHourUtc: 9,
    ...over,
  };
}

function build(policy = policyFixture()) {
  const config = makeConfig();
  const fake = new FakeAegis(policy);
  const provider = new PraxisServerProvider(config, fake as unknown as AegisClient);
  // No test may reach the PreStocks API. Proposals consult the price source
  // for their display-only USD estimate, so stub it everywhere, not just in
  // the basket suite — otherwise a buy waits out the live fetch timeout.
  provider.basketPriceSource = async (symbols) =>
    new Map(symbols.map((s) => [s, s === "ANTHROPIC" ? 20 : 10]));
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
    // 50 at the mint's real 9 decimals. The old expectation of 50_000_000n
    // encoded the 6dp guess, i.e. 0.05 OPENAI on-chain.
    expect(schedules[0].amount).toBe(50_000_000_000n);
    expect(schedules[0].decimals).toBe(9);
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
      expect(proposal.detail.amount).toBe(50_000_000_000n);
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

  test("repeating the identical schedule is a no-op with an explanation", async () => {
    const { provider } = build();
    await provider.send(null, "buy $50 openai every monday");
    const { threadId } = await provider.send(null, "buy $50 openai every monday");

    expect(provider.getSchedules()).toHaveLength(1);
    const blocks = agentBlocks(provider, threadId);
    expect(blocks.some((b) => b.type === "proposal")).toBe(false);
    const notice = blocks.find((b) => b.type === "notice");
    expect(notice?.type === "notice" && notice.text).toMatch(/already have/i);
  });

  test("a different amount or cadence is a separate schedule", async () => {
    const { provider } = build();
    await provider.send(null, "buy $50 openai every monday");
    await provider.send(null, "buy $60 openai every monday");
    await provider.send(null, "buy $50 openai daily");
    expect(provider.getSchedules()).toHaveLength(3);
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
  /** Re-stub for a test that needs a different price shape. */
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
    // $30 per share: 3 OPENAI @ $10, 1.5 ANTHROPIC @ $20, at 9 decimals.
    expect(amounts.get("OPENAI")).toBe(3_000_000_000n);
    expect(amounts.get("ANTHROPIC")).toBe(1_500_000_000n);
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

describe("unverified mint decimals", () => {
  /**
   * The PreStocks API does not report decimals. Until the scale is confirmed —
   * from the chain, or by an operator override — parsing "$50 OPENAI" could
   * move a thousand times the intended quantity. Every amount path must refuse
   * rather than guess.
   */
  function buildUnverified() {
    // No overrides and an unreachable RPC: the scale cannot be confirmed.
    const config = makeConfig({ stockDecimals: {}, tokens: [...DEFAULT_TOKENS, ...buildStockTokens()] });
    const provider = new PraxisServerProvider(
      config,
      new FakeAegis(policyFixture()) as unknown as AegisClient,
    );
    return provider;
  }

  test("a one-off buy clarifies instead of moving a guessed amount", async () => {
    const provider = buildUnverified();
    // A resolvable recipient, so the clarify we assert on is about the scale
    // and not about the address book.
    await provider.addContact("maya", "ALUMw7kSn9xn67suHr2ti21CXBQVNMuRk7uWSM1WuXEt");
    const { threadId } = await provider.send(null, "buy 40 openai to maya");
    const blocks = agentBlocks(provider, threadId);
    expect(blocks.some((b) => b.type === "proposal")).toBe(false);
    expect(blocks.some((b) => b.type === "clarify" && /decimals/i.test(b.text))).toBe(true);
  });

  test("a recurring buy is not scheduled with a guessed scale", async () => {
    const provider = buildUnverified();
    const { threadId } = await provider.send(null, "buy $50 openai every monday");
    expect(provider.getSchedules()).toHaveLength(0);
    expect(agentBlocks(provider, threadId).some((b) => b.type === "clarify")).toBe(true);
  });

  test("a basket is voided rather than split across a guessed scale", async () => {
    const provider = buildUnverified();
    const { threadId } = await provider.send(null, "buy ai basket $60");
    const blocks = agentBlocks(provider, threadId);
    expect(blocks.some((b) => b.type === "proposal")).toBe(false);
    expect(blocks.some((b) => b.type === "clarify")).toBe(true);
  });

  test("SOL is unaffected — its scale was never in question", async () => {
    const provider = buildUnverified();
    await provider.addContact("maya", "ALUMw7kSn9xn67suHr2ti21CXBQVNMuRk7uWSM1WuXEt");
    const { threadId } = await provider.send(null, "send 0.5 sol to maya");
    expect(agentBlocks(provider, threadId).some((b) => b.type === "proposal")).toBe(true);
  });
});

/**
 * The one-off counterpart to a schedule. `buy $40 openai` is the phrasing the
 * README and the submission doc lead with; it used to clarify, while
 * `buy $50 openai every monday` — the same intent, on a cadence — went
 * straight through by defaulting to the owner's own wallet.
 */
describe("one-off buy with no recipient", () => {
  test("buy $40 openai proposes a transfer into the owner's own wallet", async () => {
    const { provider, config } = build();
    const { threadId } = await provider.send(null, "buy $40 openai");

    const blocks = agentBlocks(provider, threadId);
    const proposalBlock = blocks.find((b) => b.type === "proposal");
    expect(proposalBlock).toBeDefined();
    expect(blocks.some((b) => b.type === "clarify")).toBe(false);

    const proposal = provider.getProposal(
      proposalBlock && proposalBlock.type === "proposal" ? proposalBlock.proposalId : "",
    )!;
    expect(proposal.detail.kind).toBe("transfer");
    if (proposal.detail.kind !== "transfer") return;
    expect(proposal.detail.asset.symbol).toBe("OPENAI");
    // 40 at the mint's real 9 decimals.
    expect(proposal.detail.amount).toBe(40_000_000_000n);
    expect(proposal.detail.recipientAddress).toBe(config.ownerAddress!.toBase58());
    expect(proposal.detail.recipientName).toBe("you");
    // Nothing is signed by getting here — it is a proposal like any other.
    expect(proposal.state).toBe("pending");
  });

  test("the reply says where it is going, and does not claim an address book hit", async () => {
    const { provider } = build();
    const { threadId } = await provider.send(null, "buy $40 openai");
    const prose = agentBlocks(provider, threadId)
      .filter((b) => b.type === "proposal")
      .map((b) => (b.type === "proposal" ? b.text : ""))
      .join(" ");
    expect(prose).toMatch(/your own wallet/i);
    expect(prose).not.toMatch(/address book/i);
  });

  test("a named recipient still resolves through the address book", async () => {
    const { config } = build();
    const contact = Keypair.generate().publicKey.toBase58();
    const withBook = new PraxisServerProvider(
      { ...config, addressBook: [{ label: "maya", name: "Maya Patel", address: contact }] },
      new FakeAegis(policyFixture()) as unknown as AegisClient,
    );
    withBook.basketPriceSource = async (symbols) => new Map(symbols.map((s) => [s, 10]));

    const { threadId } = await withBook.send(null, "buy $40 openai for maya");
    const block = agentBlocks(withBook, threadId).find((b) => b.type === "proposal");
    expect(block).toBeDefined();
    const proposal = withBook.getProposal(block && block.type === "proposal" ? block.proposalId : "")!;
    expect(proposal.detail.kind === "transfer" && proposal.detail.recipientAddress).toBe(contact);
  });
});
