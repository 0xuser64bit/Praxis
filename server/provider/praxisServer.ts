import { PublicKey } from "@solana/web3.js";
import {
  ActionKind,
  type ActionProposal,
  type ActivityEntry,
  type AddressBookEntry,
  type AgentBlock,
  type AllowListKind,
  type Message,
  type PolicyUpdate,
  type PolicyView,
  type PraxisProvider,
  type Thread,
  type TokenInfo,
} from "@praxis/shared";

import { AegisClient } from "../aegis/client";
import { JUPITER_PROGRAM_ID } from "../aegis/constants";
import { AddressBook } from "../agent/addressBook";
import { checkSwapPolicy } from "../agent/policy";
import {
  parseIntentLocallyForDemo,
  parseIntentWithClaude,
  type ParsedAction,
  type ParsedIntent,
} from "../agent/intent";
import { researchToken } from "../agent/research";
import { getConnection } from "../aegis/client";
import { getServerConfig, validatePublicKey, type PraxisServerConfig } from "../env";
import { PraxisNotFoundError } from "../errors";
import { parseHumanUnits, SOL_DECIMALS } from "../units";

interface StoreState {
  threads: Thread[];
  proposals: Record<string, ActionProposal>;
  activity: ActivityEntry[];
  policy?: PolicyView;
  thinking: Record<string, boolean>;
}

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

let singleton: PraxisServerProvider | undefined;

export function getPraxisServerProvider(): PraxisServerProvider {
  if (!singleton) singleton = new PraxisServerProvider();
  return singleton;
}

export function resetPraxisServerProviderForTests() {
  singleton = undefined;
}

export class PraxisServerProvider implements PraxisProvider {
  private readonly config: PraxisServerConfig;
  private readonly aegis: AegisClient;
  private readonly addressBook: AddressBook;
  private readonly listeners = new Set<() => void>();
  private state: StoreState;
  private version = 0;

  constructor(config = getServerConfig(), aegis = new AegisClient(config)) {
    this.config = config;
    this.aegis = aegis;
    this.addressBook = new AddressBook(config.addressBook);
    this.state = {
      threads: [welcomeThread(nowSeconds())],
      proposals: {},
      activity: [],
      thinking: {},
    };
  }

  // --- refresh ---
  async refreshPolicy(): Promise<PolicyView> {
    const policy = await this.aegis.getPolicy();
    this.state.policy = policy;
    return policy;
  }

  async refreshActivity(): Promise<ActivityEntry[]> {
    const logs = await this.aegis.getActionLog();
    // The on-chain ActionRecord stores no mint; for an SPL transfer the asset is
    // the policy's single configured token_mint, resolved to a known token.
    const tokenAsset = this.tokenForMint(this.state.policy?.tokenMint);
    const onChain = logs.map((entry, index): ActivityEntry => {
      const isSpl = entry.kind === ActionKind.TransferSpl;
      return {
        id: `chain-${entry.sig ?? entry.ts}-${index}`,
        // Both native and SPL transfers render as a "transfer" row; the ASSET is
        // what distinguishes them (agent_swap is v2 / not on-chain).
        kind: "transfer",
        label: this.addressBook.labelFor(entry.target),
        asset: isSpl ? tokenAsset?.symbol ?? "TOKEN" : "SOL",
        amount: entry.amount,
        decimals: isSpl ? tokenAsset?.decimals ?? SOL_DECIMALS : SOL_DECIMALS,
        result: entry.result,
        reason: entry.reason,
        reasonCode: entry.reasonCode,
        ts: entry.ts,
        sig: entry.sig,
      };
    });
    const keyed = new Map<string, ActivityEntry>();
    for (const entry of [...this.state.activity, ...onChain]) {
      keyed.set(entry.sig ?? entry.id, entry);
    }
    this.state.activity = [...keyed.values()].sort((a, b) => b.ts - a.ts);
    return this.state.activity;
  }

  async refreshOnChain(): Promise<void> {
    await this.refreshPolicy();
    await this.refreshActivity();
    this.notify();
  }

  // --- reads ---
  getThreads = (): Thread[] => [...this.state.threads].sort((a, b) => b.updatedAt - a.updatedAt);
  getThread = (id: string): Thread | undefined => this.state.threads.find((thread) => thread.id === id);
  getProposal = (id: string): ActionProposal | undefined => this.state.proposals[id];
  getPolicy = (): PolicyView => {
    if (!this.state.policy) throw new PraxisNotFoundError("Policy has not been loaded yet.");
    return this.state.policy;
  };
  getActivity = (): ActivityEntry[] => [...this.state.activity].sort((a, b) => b.ts - a.ts);
  getAddressBook = (): AddressBookEntry[] => this.addressBook.all();
  isThinking = (threadId: string): boolean => Boolean(this.state.thinking[threadId]);
  getConnectionState = () => ({ mode: "api" as const, phase: "ready" as const });
  getVersion = (): number => this.version;

  // --- conversation ---
  newThread = (preferredId?: string): string => {
    const id = preferredId ?? this.id("t");
    if (this.getThread(id)) return id;
    this.state.threads = [{ id, title: "New session", messages: [], updatedAt: nowSeconds() }, ...this.state.threads];
    this.notify();
    return id;
  };

  send = async (threadId: string | null, text: string): Promise<{ threadId: string }> => {
    const tid = threadId ?? this.newThread();
    const thread = this.requireThread(tid);
    const ts = nowSeconds();

    thread.messages = [...thread.messages, { id: this.id("m"), role: "user", ts, text }];
    thread.updatedAt = ts;
    this.state.thinking = { ...this.state.thinking, [tid]: true };
    this.notify();

    let blocks: AgentBlock[];
    let title: string | undefined;
    try {
      const intent = await this.parseIntent(text);
      const result = await this.blocksForIntent(intent);
      blocks = result.blocks;
      title = result.title;
    } catch (error) {
      blocks = [
        {
          type: "prose",
          text: error instanceof Error ? error.message : "The agent could not parse that request.",
        },
      ];
    }

    const reply: Message = { id: this.id("m"), role: "agent", ts: nowSeconds(), blocks };
    thread.messages = [...thread.messages, reply];
    if (title && (thread.title === "New session" || thread.messages.length <= 2)) thread.title = title;
    thread.updatedAt = reply.ts;
    this.state.thinking = { ...this.state.thinking, [tid]: false };
    this.notify();
    return { threadId: tid };
  };

  signProposal = async (proposalId: string): Promise<void> => {
    const proposal = this.state.proposals[proposalId];
    if (!proposal) throw new PraxisNotFoundError(`unknown proposal ${proposalId}`);
    if (proposal.state !== "pending") return;

    proposal.state = "signing";
    this.notify();

    if (proposal.detail.kind === "swap") {
      proposal.state = "blocked";
      proposal.simulation = "agent_swap is a typed stub; Jupiter CPI is not implemented.";
      this.logSwapRejection(proposal);
      this.notify();
      return;
    }

    const recipient = new PublicKey(proposal.detail.recipientAddress);
    const asset = proposal.detail.asset;
    const isSol = asset.symbol === "SOL";
    const execution = isSol
      ? await this.aegis.executeAgentTransfer(recipient, proposal.detail.amount)
      : await this.aegis.executeAgentTransferSpl(recipient, asset, proposal.detail.amount);
    proposal.check = execution.check;
    proposal.sig = execution.sig;
    proposal.state = execution.status === "confirmed" ? "signed" : "blocked";
    proposal.simulation = execution.status === "confirmed"
      ? `Confirmed through Aegis ${isSol ? "agent_transfer" : "agent_transfer_spl"}`
      : "Rejected by Aegis during execution";

    this.state.activity = [
      {
        id: this.id("a"),
        kind: "transfer",
        label: proposal.detail.recipientName,
        asset: asset.symbol,
        amount: proposal.detail.amount,
        decimals: asset.decimals,
        result: execution.status === "confirmed" ? "allowed" : "rejected",
        reason: execution.check.reason,
        reasonCode: execution.check.reasonCode,
        ts: nowSeconds(),
        sig: execution.sig,
      },
      ...this.state.activity,
    ];

    await this.refreshPolicy().catch(() => undefined);
    this.notify();
  };

  cancelProposal = async (proposalId: string): Promise<void> => {
    const proposal = this.state.proposals[proposalId];
    if (!proposal) return;
    proposal.state = "cancelled";
    this.notify();
  };

  // --- policy dashboard ---
  updatePolicy = async (patch: PolicyUpdate): Promise<void> => {
    await this.aegis.updatePolicy(patch);
    await this.refreshOnChain();
  };

  revokeAgent = async (): Promise<void> => {
    await this.aegis.revokeAgent();
    await this.refreshOnChain();
  };

  rotateAgent = async (): Promise<void> => {
    await this.aegis.rotateAgent();
    await this.refreshOnChain();
  };

  addToAllowList = async (kind: AllowListKind, address: string): Promise<void> => {
    validatePublicKey(address);
    await this.aegis.updateAllowList(kind, address, "add");
    await this.refreshOnChain();
  };

  removeFromAllowList = async (kind: AllowListKind, address: string): Promise<void> => {
    validatePublicKey(address);
    await this.aegis.updateAllowList(kind, address, "remove");
    await this.refreshOnChain();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private async parseIntent(text: string): Promise<ParsedIntent> {
    if (process.env.PRAXIS_LOCAL_INTENT === "1") return parseIntentLocallyForDemo(text);
    return parseIntentWithClaude(text, this.config);
  }

  private async blocksForIntent(intent: ParsedIntent): Promise<{ blocks: AgentBlock[]; title?: string }> {
    if (intent.outcome === "clarify") {
      return {
        blocks: [
          {
            type: "clarify",
            text: intent.question,
            options: (intent.options ?? []).map((option) => ({ label: option, value: option })),
          },
        ],
      };
    }

    if (intent.outcome === "unsupported") {
      return { blocks: [{ type: "prose", text: intent.message }] };
    }

    const blocks: AgentBlock[] = [];
    let title: string | undefined;
    for (const action of intent.actions) {
      const result = await this.blockForAction(action);
      blocks.push(...result.blocks);
      title ??= result.title;
    }
    return { blocks, title };
  }

  private async blockForAction(action: ParsedAction): Promise<{ blocks: AgentBlock[]; title?: string }> {
    if (action.kind === "transfer") return this.transferBlock(action);
    if (action.kind === "research") return this.researchBlock(action.token);
    return this.swapStubBlock(action);
  }

  private async transferBlock(action: Extract<ParsedAction, { kind: "transfer" }>): Promise<{ blocks: AgentBlock[]; title?: string }> {
    const resolved = this.addressBook.resolve(action.recipient);
    if (resolved.kind !== "exact") {
      return {
        blocks: [
          {
            type: "clarify",
            text: resolved.question,
            options: resolved.options,
          },
        ],
      };
    }

    // Native SOL routes through agent_transfer; an SPL token through the
    // dedicated token envelope (agent_transfer_spl). The asset's own decimals
    // drive amount parsing and display.
    const token = this.token(action.asset);
    const isSol = token.symbol === "SOL";
    const amount = parseHumanUnits(action.amountHuman, token.decimals);
    const recipient = new PublicKey(resolved.entry.address);
    const preview = isSol
      ? await this.aegis.simulateAgentTransfer(recipient, amount)
      : await this.aegis.simulateAgentTransferSpl(recipient, token, amount);

    const proposal: ActionProposal = {
      id: this.id("p"),
      detail: {
        kind: "transfer",
        amount,
        asset: token,
        recipientName: resolved.entry.name,
        recipientAddress: resolved.entry.address,
        recipientNote: resolved.entry.note,
      },
      networkFee: preview.networkFee,
      simulation: preview.simulation,
      check: preview.check,
      state: preview.check.allowed ? "pending" : "blocked",
    };
    this.state.proposals[proposal.id] = proposal;

    if (!preview.check.allowed) {
      this.state.activity = [
        {
          id: this.id("a"),
          kind: "transfer",
          label: resolved.entry.name,
          asset: token.symbol,
          amount,
          decimals: token.decimals,
          result: "rejected",
          reason: preview.check.reason,
          reasonCode: preview.check.reasonCode,
          ts: nowSeconds(),
        },
        ...this.state.activity,
      ];
    }

    return {
      blocks: [
        {
          type: "proposal",
          text: `Resolved ${resolved.entry.name} from the address book.`,
          proposalId: proposal.id,
        },
      ],
      title: `Send to ${resolved.entry.name.split(" ")[0]}`,
    };
  }

  private async researchBlock(token: string): Promise<{ blocks: AgentBlock[]; title?: string }> {
    const data = await researchToken(token, getConnection(this.config), this.config);
    return {
      blocks: [
        {
          type: "research",
          text: `Read-only on-chain and market data for ${data.token}. No buy, sell, or hold advice.`,
          data,
        },
      ],
      title: `${data.token} research`,
    };
  }

  private async swapStubBlock(action: Extract<ParsedAction, { kind: "swap_stub" }>): Promise<{ blocks: AgentBlock[]; title?: string }> {
    const assetIn = this.token(action.assetIn);
    const assetOut = this.token(action.assetOut);
    const amountIn = parseHumanUnits(action.amountHuman, assetIn.decimals);

    // Run the SAME allow-list check the mock runs, so demo §9 #3 ("the allow-list
    // holds") is faithful in API mode. This is an agent-layer (pre-CPI) verdict:
    // the on-chain agent_swap is v2, so a rejection here is the honest gate, not
    // an on-chain RejectReason. Falls back to a plain stub if the policy can't be
    // loaded (half-configured API mode).
    const policy = await this.ensurePolicy();
    const check = policy
      ? checkSwapPolicy(policy, assetOut, JUPITER_PROGRAM_ID.toBase58(), nowSeconds())
      : undefined;

    // A swap can never EXECUTE today (no Jupiter CPI), so the proposal is always
    // blocked. The REASON is what we make faithful: an allow-list rejection when
    // the policy forbids the route, else an honest "v2 not built" note.
    const blockedReason = !check
      ? "agent_swap is a typed stub for v2. No Jupiter CPI is constructed or signed."
      : check.allowed
        ? "Your Aegis policy would allow this route, but agent_swap (the on-chain Jupiter CPI) is a v2 instruction and isn't built yet — Praxis won't sign a swap it can't enforce on-chain."
        : check.reason;

    const proposal: ActionProposal = {
      id: this.id("p"),
      detail: {
        kind: "swap",
        amountIn,
        assetIn,
        estAmountOut: 0n,
        assetOut,
        route: "agent_swap stub",
        priceImpactBps: 0,
      },
      networkFee: 0n,
      simulation: check && !check.allowed
        ? `Would be rejected by policy: ${check.reason}`
        : "agent_swap is intentionally out of scope; Jupiter CPI is not built.",
      check: {
        allowed: false,
        reason: blockedReason,
        spentToday: check?.spentToday ?? policy?.spentToday ?? 0n,
        dailyLimit: check?.dailyLimit ?? policy?.dailyLimit ?? 0n,
        remaining: check?.remaining ?? 0n,
      },
      state: "blocked",
    };
    this.state.proposals[proposal.id] = proposal;
    this.logSwapRejection(proposal);

    const blocked = Boolean(check && !check.allowed);
    return {
      blocks: [
        {
          type: "proposal",
          text: blocked
            ? "I found a route, but your Aegis policy blocks it."
            : "Swap intent parsed, but agent_swap is a typed stub until the Jupiter CPI is implemented.",
          proposalId: proposal.id,
        },
      ],
      title: `${assetIn.symbol} swap stub`,
    };
  }

  /** Return the cached policy, loading it once if needed; undefined if unloadable. */
  private async ensurePolicy(): Promise<PolicyView | undefined> {
    if (this.state.policy) return this.state.policy;
    try {
      return await this.refreshPolicy();
    } catch {
      return undefined;
    }
  }

  private logSwapRejection(proposal: ActionProposal) {
    if (proposal.detail.kind !== "swap") return;
    this.state.activity = [
      {
        id: this.id("a"),
        kind: "swap",
        label: `${proposal.detail.assetIn.symbol} -> ${proposal.detail.assetOut.symbol}`,
        asset: proposal.detail.assetIn.symbol,
        amount: proposal.detail.amountIn,
        decimals: proposal.detail.assetIn.decimals,
        result: "rejected",
        reason: proposal.check.reason,
        ts: nowSeconds(),
      },
      ...this.state.activity,
    ];
  }

  private requireThread(id: string): Thread {
    const thread = this.getThread(id);
    if (!thread) throw new PraxisNotFoundError(`unknown thread ${id}`);
    return thread;
  }

  /** Resolve the policy's configured token mint to a known TokenInfo. */
  private tokenForMint(mint: string | undefined): TokenInfo | undefined {
    if (!mint) return undefined;
    return this.config.tokens.find((item) => item.mint === mint);
  }

  private token(symbol: string): TokenInfo {
    const normalized = symbol.trim().replace(/^\$/, "").toUpperCase();
    const token = this.config.tokens.find((item) => item.symbol.toUpperCase() === normalized);
    if (token) return token;
    return {
      symbol: normalized,
      mint: SYSTEM_PROGRAM,
      decimals: SOL_DECIMALS,
      verified: false,
    };
  }

  private id(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private notify() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

function welcomeThread(ts: number): Thread {
  return {
    id: "t-welcome",
    title: "New session",
    updatedAt: ts,
    messages: [
      {
        id: "m-welcome",
        role: "agent",
        ts,
        blocks: [
          {
            type: "prose",
            text:
              "Praxis is connected to the Aegis policy engine. Ask for a SOL send, token research, or a swap preview.",
          },
        ],
      },
    ],
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
