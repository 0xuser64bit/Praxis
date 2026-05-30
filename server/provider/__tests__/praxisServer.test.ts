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
