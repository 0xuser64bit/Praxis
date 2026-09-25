import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Keypair } from "@solana/web3.js";
import { ActionKind, type ActionLogEntry, type PolicyView } from "@praxis/shared";

import { PraxisServerProvider } from "../praxisServer";
import type { AegisClient, TransferExecution, TransferSimulation } from "../../aegis/client";
import { DEFAULT_AEGIS_PROGRAM_ID } from "../../aegis/constants";
import { DEFAULT_PRESTOCKS_API_URL, DEFAULT_PRESTOCKS_TIMEOUT_MS, DEFAULT_TOKENS, type PraxisServerConfig } from "../../env";
import { PraxisConfigError } from "../../errors";
import { getStateRepository } from "../stateRepository";
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
  vaultTokenBalance: () => Promise<bigint | undefined> = async () => undefined;
  getVaultTokenBalance() {
    return this.vaultTokenBalance();
  }
  actionLog: ActionLogEntry[] = [];
  async getActionLog() {
    return this.actionLog;
  }
  async simulateAgentTransfer() {
    this.calls.push("simulateAgentTransfer");
    return this.simResult;
  }
  async executeAgentTransfer(
    _recipient: Keypair["publicKey"],
    _amount: bigint,
    opts?: { onSubmitted?: (sig: string) => Promise<void> },
  ) {
    this.calls.push("executeAgentTransfer");
    await opts?.onSubmitted?.(this.execResult.sig ?? "sig-unknown");
    return this.execResult;
  }
  async simulateAgentTransferSpl() {
    this.calls.push("simulateAgentTransferSpl");
    return this.simResult;
  }
  async executeAgentTransferSpl(
    _recipient: Keypair["publicKey"],
    _token: unknown,
    _amount: bigint,
    opts?: { onSubmitted?: (sig: string) => Promise<void> },
  ) {
    await opts?.onSubmitted?.(this.execResult.sig ?? "sig-unknown");
    return this.execResult;
  }
  async revokeAgent() {
    this.calls.push("revokeAgent");
    return "sig";
  }
  async closePolicy() {
    this.calls.push("closePolicy");
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
    intentProviders: [],
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
    stocksEnabled: false,
    prestocksApiUrl: DEFAULT_PRESTOCKS_API_URL,
    prestocksTimeoutMs: DEFAULT_PRESTOCKS_TIMEOUT_MS,
    stockUniverse: undefined,
    stockDecimals: {},
    stockMints: {},
    scheduleHourUtc: 9,
    ...over,
  };
}

function build(over: Partial<PraxisServerConfig> = {}, policy = policyFixture()) {
  const fake = new FakeAegis(policy);
  const provider = new PraxisServerProvider(makeConfig(over), fake as unknown as AegisClient);
  return { provider, fake };
}

describe("refreshPolicy", () => {
  test("attaches the vault's token balance to the policy", async () => {
    const { provider, fake } = build();
    fake.vaultTokenBalance = async () => 1_000_000_000n;
    expect((await provider.refreshPolicy()).vaultTokenBalance).toBe(1_000_000_000n);
    expect(provider.getPolicy().vaultTokenBalance).toBe(1_000_000_000n);
  });

  test("a failed token balance read leaves it unknown, not zero, and keeps the policy", async () => {
    const { provider, fake } = build();
    fake.vaultTokenBalance = async () => {
      throw new Error("rpc down");
    };
    const policy = await provider.refreshPolicy();
    expect(policy.address).toBe(fake.policy.address);
    expect("vaultTokenBalance" in policy).toBe(false);
  });
});

describe("clarification continuations", () => {
  const ALEX_KIM = "ALUMw7kSn9xn67suHr2ti21CXBQVNMuRk7uWSM1WuXEt";
  const ALEX_RIVERA = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

  test("an ambiguous contact keeps the original transfer intent", async () => {
    const { provider } = build({
      addressBook: [
        { label: "alex", name: "Alex Kim", address: ALEX_KIM },
        { label: "alex", name: "Alex Rivera", address: ALEX_RIVERA },
      ],
    });
    const first = await provider.send(null, "send 0.5 sol to alex");
    const clarify = (provider.getThread(first.threadId)!.messages.at(-1) as {
      blocks: Array<{ type: string; options?: Array<{ value: string }> }>;
    }).blocks.find((block) => block.type === "clarify")!;
    expect(clarify.options).toHaveLength(2);
    expect(clarify.options!.map((option) => option.value)).toEqual([
      `send 0.5 SOL to ${ALEX_KIM}`,
      `send 0.5 SOL to ${ALEX_RIVERA}`,
    ]);

    await provider.send(first.threadId, clarify.options![1].value);
    const proposalBlock = (provider.getThread(first.threadId)!.messages.at(-1) as {
      blocks: Array<{ type: string; proposalId?: string }>;
    }).blocks.find((block) => block.type === "proposal")!;
    const proposal = provider.getProposal(proposalBlock.proposalId!)!;
    expect(proposal.detail.kind).toBe("transfer");
    if (proposal.detail.kind === "transfer") {
      expect(proposal.detail.amount).toBe(500_000_000n);
      expect(proposal.detail.asset.symbol).toBe("SOL");
      expect(proposal.detail.recipientAddress).toBe(ALEX_RIVERA);
    }
  });
});

describe("unknown assets", () => {
  test("an unrecognized symbol clarifies instead of simulating a placeholder mint", async () => {
    const { provider, fake } = build();
    const { threadId } = await provider.send(null, "send 5 FOO to maya");
    const blocks = (provider.getThread(threadId)!.messages.at(-1) as {
      blocks: Array<{ type: string; text: string }>;
    }).blocks;

    expect(blocks.some((b) => b.type === "proposal")).toBe(false);
    const clarify = blocks.find((b) => b.type === "clarify");
    expect(clarify?.text).toMatch(/don't recognize "FOO"/);
    // It must not have reached the chain at all: the old placeholder token
    // (system-program mint) ran a real SPL simulation and reported a missing
    // token account, which reads as a setup problem rather than a typo.
    expect(fake.calls).not.toContain("simulateAgentTransferSpl");
  });

  test("SOL still routes natively", async () => {
    const { provider, fake } = build();
    await provider.send(null, "send 0.5 sol to maya");
    expect(fake.calls).toContain("simulateAgentTransfer");
  });

  test("a send with no recipient asks, and never settles to yourself", async () => {
    // A buy with no recipient defaults to the owner's own wallet; a send with
    // no recipient must not inherit that. "You forgot to say who" and "you
    // meant yourself" are different sentences, and only one is an instruction.
    const { provider, fake } = build();
    const { threadId } = await provider.send(null, "send 0.5 sol");
    const blocks = (provider.getThread(threadId)!.messages.at(-1) as {
      blocks: Array<{ type: string }>;
    }).blocks;

    expect(blocks.some((b) => b.type === "proposal")).toBe(false);
    expect(fake.calls).not.toContain("simulateAgentTransfer");
  });
});

describe("concurrent signers (optimistic concurrency)", () => {
  test("two instances holding the same pending proposal execute it exactly once", async () => {
    // One wallet, two providers built from the SAME loaded revision — the
    // shape of two serverless instances serving a duplicated confirm tap.
    const owner = Keypair.generate();
    const config = makeConfig({
      ownerAddress: owner.publicKey,
      ownerKeypair: owner,
      policyAddress: findPolicyPda(owner.publicKey, DEFAULT_AEGIS_PROGRAM_ID),
    });
    const policy = policyFixture();

    const first = new PraxisServerProvider(config, new FakeAegis(policy) as unknown as AegisClient);
    const { threadId } = await first.send(null, "send 0.5 sol to maya");
    const thread = first.getThread(threadId)!;
    const block = (thread.messages.at(-1) as { blocks: Array<{ type: string; proposalId?: string }> }).blocks.find(
      (b) => b.type === "proposal",
    )!;
    const proposalId = block.proposalId!;

    // Load twice, independently: two instances each deserialize their own copy
    // of the document. Sharing one loaded object would make them alias the same
    // proposal and pass this test for the wrong reason.
    const repository = getStateRepository();
    const loadedA = await repository.load(owner.publicKey.toBase58());
    const loadedB = await repository.load(owner.publicKey.toBase58());
    expect(loadedA?.rev).toBe(loadedB!.rev);
    expect(loadedA!.state.proposals[proposalId].state).toBe("pending");
    expect(loadedB!.state.proposals[proposalId].state).toBe("pending");

    const instanceA = new PraxisServerProvider(config, new FakeAegis(policy) as unknown as AegisClient, loadedA);
    const instanceB = new PraxisServerProvider(config, new FakeAegis(policy) as unknown as AegisClient, loadedB);
    const aegisA = (instanceA as unknown as { aegis: FakeAegis }).aegis;
    const aegisB = (instanceB as unknown as { aegis: FakeAegis }).aegis;

    // Both see `pending`; only the one that wins the CAS claim may submit.
    await instanceA.signProposal(proposalId);
    await instanceB.signProposal(proposalId);

    const submissions =
      aegisA.calls.filter((c) => c === "executeAgentTransfer").length +
      aegisB.calls.filter((c) => c === "executeAgentTransfer").length;
    expect(submissions).toBe(1);
  });
});

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

  test("an unresolved submission stays actionable and is not recorded as rejected", async () => {
    const { provider, fake } = build();
    fake.execResult = {
      sig: "sig-unknown",
      check: { allowed: true, spentToday: 0n, dailyLimit: 1_000_000_000n, remaining: 500_000_000n },
      status: "submitted",
      logs: [],
    };
    const { threadId } = await provider.send(null, "send 0.5 sol to maya");
    const block = (provider.getThread(threadId)!.messages.at(-1) as { blocks: Array<{ proposalId?: string; type: string }> }).blocks.find(
      (item) => item.type === "proposal",
    )!;
    const proposal = provider.getProposal(block.proposalId!)!;

    await provider.signProposal(proposal.id);

    expect(provider.getProposal(proposal.id)!.state).toBe("submitted");
    expect(provider.getProposal(proposal.id)!.sig).toBe("sig-unknown");
    expect(provider.getActivity().some((entry) => entry.result === "rejected")).toBe(false);
    await provider.signProposal(proposal.id);
    expect(fake.calls.filter((call) => call === "executeAgentTransfer")).toHaveLength(1);
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
  test("advances when a proposal changes state without adding activity", async () => {
    const { provider } = build();
    const before = provider.getVersion();

    const { threadId } = await provider.send(null, "send 0.5 sol to maya");
    const proposalBlock = (provider.getThread(threadId)!.messages.at(-1) as {
      blocks: Array<{ type: string; proposalId?: string }>;
    }).blocks.find((block) => block.type === "proposal")!;
    const proposal = provider.getProposal(proposalBlock.proposalId!)!;
    const beforeSign = provider.getVersion();
    await provider.signProposal(proposal.id);

    expect(provider.getVersion()).toBeGreaterThan(beforeSign);
    expect(provider.getVersion()).toBeGreaterThan(before);
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

describe("contacts management", () => {
  const OPS = "8xdGRM1bAy4gFDQrdiFesF1FsuRYdecDYC3B5wofYi9t";

  test("addContact saves and resolves; removeContact drops by label or address", async () => {
    const { provider } = build();
    await provider.addContact("Ops", OPS);
    expect(provider.getAddressBook().some((e) => e.label === "ops" && e.address === OPS)).toBe(true);
    await provider.removeContact("OPS"); // case-insensitive label
    expect(provider.getAddressBook().some((e) => e.address === OPS)).toBe(false);
    // unknown keys are a no-op, never an error
    await provider.removeContact("nobody-here");
  });

  test("addContact rejects bad input", async () => {
    const { provider } = build();
    await expect(provider.addContact("bad", "not-an-address")).rejects.toThrow(/valid Solana public key/);
    await expect(provider.addContact("   ", OPS)).rejects.toThrow(/non-empty string/);
  });

  test("removing a seeded contact survives reconstruction (tombstone)", async () => {
    const owner = Keypair.generate();
    const agent = Keypair.generate();
    const config = makeConfig({
      ownerAddress: owner.publicKey,
      ownerKeypair: owner,
      agentKeypair: agent,
      policyAddress: findPolicyPda(owner.publicKey, DEFAULT_AEGIS_PROGRAM_ID),
    });
    const fake = new FakeAegis(policyFixture());
    const asClient = () => fake as unknown as AegisClient;

    const first = new PraxisServerProvider(config, asClient());
    expect(first.getAddressBook().some((e) => e.label === "maya")).toBe(true);
    await first.removeContact("maya");

    const stored = await getStateRepository().load(owner.publicKey.toBase58());
    const second = new PraxisServerProvider(config, asClient(), stored);
    expect(second.getAddressBook().some((e) => e.label === "maya")).toBe(false);

    // re-adding clears the tombstone
    await second.addContact("Maya", MAYA);
    const stored2 = await getStateRepository().load(owner.publicKey.toBase58());
    const third = new PraxisServerProvider(config, asClient(), stored2);
    expect(third.getAddressBook().some((e) => e.label === "maya")).toBe(true);
  });
});

describe("transfer with no destination at all", () => {
  test("a transfer carrying neither a recipient nor toSelf asks, it does not self-route", async () => {
    // Neither producer emits this shape — the model path rejects it and the
    // deterministic parser never builds it — but the type still allows it, and
    // the one consumer that would act on it must not read "no destination" as
    // "your own wallet".
    const { provider, fake } = build();
    const blocks = await (
      provider as unknown as {
        transferBlock: (a: unknown) => Promise<{ blocks: Array<{ type: string }> }>;
      }
    ).transferBlock({ kind: "transfer", asset: "SOL", amountHuman: "0.5" });

    expect(blocks.blocks.some((b) => b.type === "clarify")).toBe(true);
    expect(blocks.blocks.some((b) => b.type === "proposal")).toBe(false);
    expect(fake.calls).not.toContain("simulateAgentTransfer");
  });
});

describe("activity feed identity", () => {
  function chainEntry(seq: number, over: Partial<ActionLogEntry> = {}): ActionLogEntry {
    return {
      seq,
      kind: ActionKind.Transfer,
      amount: 500_000_000n,
      target: MAYA,
      result: "allowed",
      ts: Math.floor(Date.now() / 1000),
      ...over,
    };
  }

  test("a repeated refresh does not duplicate on-chain rows as the ring rotates", async () => {
    const { provider, fake } = build();
    fake.actionLog = [chainEntry(0)];
    await provider.refreshActivity();
    // A newer action lands: every earlier entry's ARRAY INDEX shifts by one.
    // Its identity must not.
    fake.actionLog = [chainEntry(1, { amount: 1n }), chainEntry(0)];
    await provider.refreshActivity();
    await provider.refreshActivity();

    const ids = provider.getActivity().map((entry) => entry.id);
    expect(ids).toEqual([...new Set(ids)]);
    expect(ids.filter((id) => id.startsWith("chain-")).length).toBe(2);
  });

  test("a signed transfer appears once, with its signature, not twice", async () => {
    const { provider, fake } = build();
    const { threadId } = await provider.send(null, "send 0.5 SOL to maya");
    const blocks = (provider.getThread(threadId)!.messages.at(-1) as {
      blocks: Array<{ type: string; proposalId?: string }>;
    }).blocks;
    const proposalId = blocks.find((b) => b.type === "proposal")!.proposalId!;
    await provider.signProposal(proposalId);

    // The same transfer, now recorded on-chain.
    fake.actionLog = [chainEntry(0)];
    await provider.refreshActivity();

    const transfers = provider.getActivity().filter((entry) => entry.result === "allowed");
    expect(transfers).toHaveLength(1);
    expect(transfers[0].sig).toBe("sig-confirmed");
    expect(transfers[0].id).toBe("chain-0");
  });
});

describe("the signature gate", () => {
  async function pendingProposal() {
    const { provider, fake } = build();
    const { threadId } = await provider.send(null, "send 0.5 SOL to maya");
    const blocks = (provider.getThread(threadId)!.messages.at(-1) as {
      blocks: Array<{ type: string; proposalId?: string }>;
    }).blocks;
    return { provider, fake, proposalId: blocks.find((b) => b.type === "proposal")!.proposalId! };
  }

  test("refuses a stale proposal instead of signing a preview nobody read", async () => {
    const { provider, fake, proposalId } = await pendingProposal();
    const proposal = provider.getProposal(proposalId)!;
    // Aegis would still enforce the envelope; what it cannot know is whether
    // the person authorized THIS card or one from last month.
    proposal.createdAt = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;

    await provider.signProposal(proposalId);

    expect(fake.calls).not.toContain("executeAgentTransfer");
    expect(provider.getProposal(proposalId)!.state).toBe("blocked");
    expect(provider.getProposal(proposalId)!.check.reason).toMatch(/days old/);
  });

  test("a weekly recurring buy is still signable six days later", async () => {
    // The amount is fixed when the card is built and Aegis enforces the
    // envelope live, so an older card still moves exactly what it says. The
    // TTL guards against forgetting, and must not quietly break the schedule
    // the product promised.
    const { provider, fake, proposalId } = await pendingProposal();
    provider.getProposal(proposalId)!.createdAt =
      Math.floor(Date.now() / 1000) - 6 * 24 * 60 * 60;

    await provider.signProposal(proposalId);
    expect(fake.calls).toContain("executeAgentTransfer");
    expect(provider.getProposal(proposalId)!.state).toBe("signed");
  });

  test("signs a fresh proposal", async () => {
    const { provider, fake, proposalId } = await pendingProposal();
    await provider.signProposal(proposalId);
    expect(fake.calls).toContain("executeAgentTransfer");
    expect(provider.getProposal(proposalId)!.state).toBe("signed");
  });

  test("a pre-submission failure leaves the proposal signable instead of stuck", async () => {
    // The claim persists "signing" before anything reaches the chain. If a
    // pre-broadcast read or the signer round-trip throws, the card must come
    // back to pending: the claim only proceeds from pending and cancel ignores
    // anything else, so a stuck "signing" would make every later tap silently
    // no-op with no way back.
    const { provider, fake, proposalId } = await pendingProposal();
    const retry = Object.getPrototypeOf(fake).executeAgentTransfer.bind(fake);
    fake.executeAgentTransfer = async () => {
      throw new Error("rpc down");
    };
    await expect(provider.signProposal(proposalId)).rejects.toThrow("rpc down");
    expect(provider.getProposal(proposalId)!.state).toBe("pending");

    // Nothing was submitted, so retrying after the outage signs exactly once.
    fake.executeAgentTransfer = retry;
    await provider.signProposal(proposalId);
    expect(provider.getProposal(proposalId)!.state).toBe("signed");
    expect(fake.calls.filter((c) => c === "executeAgentTransfer")).toHaveLength(1);
  });
});

describe("agent teardown", () => {
  test("forgets the vault it described, so a re-created agent starts clean", async () => {
    const { provider, fake } = build();
    await provider.send(null, "send 0.5 SOL to maya");
    fake.actionLog = [
      {
        seq: 0,
        kind: ActionKind.Transfer,
        amount: 1n,
        target: MAYA,
        result: "allowed",
        ts: Math.floor(Date.now() / 1000),
      },
    ];
    await provider.refreshActivity();
    expect(provider.getActivity().length).toBeGreaterThan(0);

    await provider.deleteAgent();

    // Re-initializing lands on the same deterministic PDA with a log counter
    // that restarts at zero, so a kept row would collide with a new one.
    expect(provider.getActivity()).toEqual([]);
    expect(provider.getAllProposals()).toEqual([]);
    expect(() => provider.getPolicy()).toThrow();
  });
});

describe("a browser reading", () => {
  function agentText(provider: PraxisServerProvider, threadId: string): string {
    const message = provider.getThread(threadId)!.messages.at(-1);
    return JSON.stringify(message);
  }

  test("uses the browser's reading and does not keep fields the normalizer drops", async () => {
    const { provider } = build();
    const sentinel = "AIzaSySENTINEL-NOT-A-STORED-KEY";
    const { threadId } = await provider.send(null, "hello there", {
      ownIntent: {
        outcome: "clarify",
        question: "Which asset should I move?",
        leakedKey: sentinel,
      },
    });

    const stored = agentText(provider, threadId);
    expect(stored).toContain("Which asset should I move?");
    expect(stored).not.toContain("Do you want to send SOL");
    expect(stored).not.toContain(sentinel);
    expect(JSON.stringify(provider.getThread(threadId))).not.toContain(sentinel);
  });

  test("says so when the browser key did not answer, then uses the shared parser", async () => {
    const { provider } = build();
    const { threadId } = await provider.send(null, "hello there", { ownIntentFailed: true });
    const stored = agentText(provider, threadId);
    expect(stored).toContain("Your key didn't answer, so this message used the shared parser.");
    expect(stored).toContain("Do you want to send SOL");
  });

  test("falls back to the shared parser when the reading is unusable", async () => {
    const { provider } = build();
    const { threadId } = await provider.send(null, "hello there", {
      ownIntent: { outcome: "actions", actions: [{ kind: "transfer" }] },
    });
    const stored = agentText(provider, threadId);
    expect(stored).toContain("couldn't use, so this message used the shared parser.");
    expect(stored).toContain("Do you want to send SOL");
  });
});
