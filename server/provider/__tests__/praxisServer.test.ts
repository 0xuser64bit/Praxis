import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Keypair } from "@solana/web3.js";
import type { PolicyView } from "@praxis/shared";

import { PraxisServerProvider } from "../praxisServer";
import type { AegisClient, TransferExecution, TransferSimulation } from "../../aegis/client";
import { DEFAULT_AEGIS_PROGRAM_ID } from "../../aegis/constants";
import { DEFAULT_TOKENS, type PraxisServerConfig } from "../../env";
import { PraxisConfigError } from "../../errors";
import { findPolicyPda } from "../../aegis/pdas";
import { policyFixture } from "../../testing/fixtures";

const MAYA = "ALUMw7kSn9xn67suHr2ti21CXBQVNMuRk7uWSM1WuXEt";

let prevDir: string | undefined;
let prevIntent: string | undefined;

beforeAll(() => {
  prevDir = process.env.PRAXIS_STATE_DIR;
  prevIntent = process.env.PRAXIS_LOCAL_INTENT;
  process.env.PRAXIS_STATE_DIR = mkdtempSync(join(tmpdir(), "praxis-prov-"));
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
  calls: string[] = [];

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
    this.calls.push("simulateAgentTransfer");
    return this.simResult;
  }
  async executeAgentTransfer() {
    this.calls.push("executeAgentTransfer");
    return this.execResult;
  }
  async simulateAgentTransferSpl() {
    return this.simResult;
  }
  async executeAgentTransferSpl() {
    return this.execResult;
  }
  async revokeAgent() {
    this.calls.push("revokeAgent");
    return "sig";
  }
  async updatePolicy() {
    this.calls.push("updatePolicy");
    return "sig";
  }
}

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
    addressBook: [{ label: "maya", name: "Maya Patel", address: MAYA, note: "saved contact" }],
    tokens: DEFAULT_TOKENS,
    ...over,
  };
}

function build(over: Partial<PraxisServerConfig> = {}, policy = policyFixture()) {
  const fake = new FakeAegis(policy);
  const provider = new PraxisServerProvider(makeConfig(over), fake as unknown as AegisClient);
  return { provider, fake };
}

describe("send → sign flow", () => {
  test("resolves a contact, previews, and confirms a SOL send", async () => {
    const { provider, fake } = build();
    const { threadId } = await provider.send(null, "send 0.5 sol to maya");

    const thread = provider.getThread(threadId)!;
    const agentMsg = thread.messages.find((m) => m.role === "agent")!;
    const block = (agentMsg as { blocks: Array<{ type: string; proposalId?: string }> }).blocks.find(
      (b) => b.type === "proposal",
    )!;
    const proposal = provider.getProposal(block.proposalId!)!;
    expect(proposal.state).toBe("pending");
    expect(proposal.detail.kind).toBe("transfer");

    await provider.signProposal(proposal.id);
    expect(provider.getProposal(proposal.id)!.state).toBe("signed");
    expect(fake.calls).toContain("executeAgentTransfer");
    const activity = provider.getActivity();
    expect(activity[0].result).toBe("allowed");
    expect(activity[0].sig).toBe("sig-confirmed");
  });

  test("a blocked preview yields a blocked proposal and a rejected activity row", async () => {
    const { provider, fake } = build();
    fake.simResult = {
      check: { allowed: false, reason: "over the daily limit", spentToday: 0n, dailyLimit: 1n, remaining: 0n },
      simulation: "Would be rejected by Aegis",
      networkFee: 5000n,
      logs: [],
    };
    const { threadId } = await provider.send(null, "send 0.5 sol to maya");
    const thread = provider.getThread(threadId)!;
    const block = (thread.messages.at(-1) as { blocks: Array<{ type: string; proposalId?: string }> }).blocks.find(
      (b) => b.type === "proposal",
    )!;
    const proposal = provider.getProposal(block.proposalId!)!;
    expect(proposal.state).toBe("blocked");
    expect(provider.getActivity()[0].result).toBe("rejected");
  });

  test("signing a blocked proposal is a no-op (does not reach the executor)", async () => {
    const { provider, fake } = build();
    fake.simResult = {
      check: { allowed: false, reason: "nope", spentToday: 0n, dailyLimit: 1n, remaining: 0n },
      simulation: "blocked",
      networkFee: 0n,
      logs: [],
    };
    const { threadId } = await provider.send(null, "send 0.5 sol to maya");
    const block = (provider.getThread(threadId)!.messages.at(-1) as { blocks: Array<{ proposalId?: string; type: string }> }).blocks.find(
      (b) => b.type === "proposal",
    )!;
    await provider.signProposal(block.proposalId!);
    expect(fake.calls).not.toContain("executeAgentTransfer");
  });
});

describe("getVersion cursor", () => {
  test("reflects the newest thread/activity timestamp and advances after a send", async () => {
    const { provider } = build();
    // Fresh provider: cursor is the welcome thread's updatedAt (a recent unix ts).
    const before = provider.getVersion();
    expect(before).toBeGreaterThan(0);

    await provider.send(null, "send 0.5 sol to maya");
    // A send writes a user + agent message and bumps thread.updatedAt, so the
    // durable cursor must not regress (and tracks the latest mutation).
    expect(provider.getVersion()).toBeGreaterThanOrEqual(before);
  });
});

describe("swap stub", () => {
  test("a swap is always blocked and never reaches an executor", async () => {
    const policy = policyFixture({ allowedPrograms: [], allowedMints: [] });
    const { provider, fake } = build({}, policy);
    const { threadId } = await provider.send(null, "swap 1 usdc for bonk");
    const block = (provider.getThread(threadId)!.messages.at(-1) as { blocks: Array<{ proposalId?: string; type: string }> }).blocks.find(
      (b) => b.type === "proposal",
    )!;
    const proposal = provider.getProposal(block.proposalId!)!;
    expect(proposal.state).toBe("blocked");
    expect(proposal.check.allowed).toBe(false);
    await provider.signProposal(proposal.id);
    expect(fake.calls).not.toContain("executeAgentTransfer");
  });
});

describe("owner-action signing gate", () => {
  test("owner mutations throw when no backend owner keypair matches the wallet", async () => {
    const wallet = Keypair.generate().publicKey;
    const { provider } = build({
      ownerAddress: wallet,
      ownerKeypair: undefined,
      policyAddress: findPolicyPda(wallet, DEFAULT_AEGIS_PROGRAM_ID),
    });
    await expect(provider.revokeAgent()).rejects.toBeInstanceOf(PraxisConfigError);
    await expect(provider.rotateAgent()).rejects.toBeInstanceOf(PraxisConfigError);
    await expect(provider.updatePolicy({ paused: true })).rejects.toBeInstanceOf(PraxisConfigError);
  });

  test("owner mutations proceed when the owner keypair matches", async () => {
    const { provider, fake } = build();
    await provider.revokeAgent().catch(() => undefined);
    expect(fake.calls).toContain("revokeAgent");
  });
});

describe("policy questions", () => {
  test("explains the policy from real numbers", async () => {
    const { provider } = build();
    const { threadId } = await provider.send(null, "how does my policy keep me safe");
    const msg = provider.getThread(threadId)!.messages.at(-1) as { blocks: Array<{ type: string; text?: string }> };
    const proseText = msg.blocks.filter((b) => b.type === "prose").map((b) => b.text).join("\n").toLowerCase();
    expect(proseText).toContain("per-transaction cap");
    expect(proseText).toContain("keeps you safe");
  });
});

describe("save contact", () => {
  const ADDR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

  test("saves a contact and confirms with a notice block", async () => {
    const { provider } = build();
    const { threadId } = await provider.send(null, `save ${ADDR} as backpack`);
    const msg = provider.getThread(threadId)!.messages.at(-1) as { blocks: Array<{ type: string }> };
    expect(msg.blocks.some((b) => b.type === "notice")).toBe(true);
    expect(provider.getAddressBook().some((e) => e.label === "backpack" && e.address === ADDR)).toBe(true);
  });

  test("compound send + save: saves the contact and previews the transfer", async () => {
    const { provider } = build();
    const { threadId } = await provider.send(null, `send 0.1 sol to ${ADDR} and save this address as backpack`);
    const blocks = (provider.getThread(threadId)!.messages.at(-1) as { blocks: Array<{ type: string }> }).blocks;
    expect(blocks.some((b) => b.type === "notice")).toBe(true);
    expect(blocks.some((b) => b.type === "proposal")).toBe(true);
    expect(provider.getAddressBook().some((e) => e.label === "backpack")).toBe(true);
  });

  test("rejects an invalid address with a clarify block, saves nothing", async () => {
    const { provider } = build();
    const { threadId } = await provider.send(null, "save not-an-address as oops");
    const blocks = (provider.getThread(threadId)!.messages.at(-1) as { blocks: Array<{ type: string }> }).blocks;
    expect(blocks.some((b) => b.type === "clarify")).toBe(true);
    expect(provider.getAddressBook().some((e) => e.label === "oops")).toBe(false);
  });
});
