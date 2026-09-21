/**
 * The research conversation, end to end through `send`.
 *
 * Three real transcripts prompted this suite:
 *   "research about trump coin"      -> Unknown token "TRUMP"
 *   "research about 6p6xgHy…"        -> Unknown token "ABOUT"
 *   "research for this coin TRUMP…"  -> Unknown token "THIS"
 * Each dead-ended on "Try a mint address instead" — advice that could not be
 * followed, because the alias pass upper-cased a pasted mint before anything
 * looked at it.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Keypair } from "@solana/web3.js";
import type { AgentBlock } from "@praxis/shared";

import { PraxisServerProvider } from "../praxisServer";
import type { AegisClient } from "../../aegis/client";
import { DEFAULT_AEGIS_PROGRAM_ID } from "../../aegis/constants";
import {
  DEFAULT_PRESTOCKS_API_URL,
  DEFAULT_PRESTOCKS_TIMEOUT_MS,
  DEFAULT_TOKENS,
  type PraxisServerConfig,
} from "../../env";
import { findPolicyPda } from "../../aegis/pdas";
import { policyFixture } from "../../testing/fixtures";

const OFFICIAL_TRUMP = "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN";

let prevDir: string | undefined;
let prevIntent: string | undefined;

beforeAll(() => {
  prevDir = process.env.PRAXIS_STATE_DIR;
  prevIntent = process.env.PRAXIS_LOCAL_INTENT;
  process.env.PRAXIS_STATE_DIR = mkdtempSync(join(tmpdir(), "praxis-research-"));
  // The offline parser, on purpose: it is what actually answers whenever the
  // model is rate-limited or down, which on a free tier is often.
  process.env.PRAXIS_LOCAL_INTENT = "1";
});

afterAll(() => {
  if (prevDir === undefined) delete process.env.PRAXIS_STATE_DIR;
  else process.env.PRAXIS_STATE_DIR = prevDir;
  if (prevIntent === undefined) delete process.env.PRAXIS_LOCAL_INTENT;
  else process.env.PRAXIS_LOCAL_INTENT = prevIntent;
});

function config(): PraxisServerConfig {
  const owner = Keypair.generate();
  return {
    rpcUrl: "http://127.0.0.1:8899",
    researchRpcUrl: "http://127.0.0.1:8899",
    commitment: "confirmed",
    programId: DEFAULT_AEGIS_PROGRAM_ID,
    ownerAddress: owner.publicKey,
    ownerKeypair: owner,
    agentKeypair: Keypair.generate(),
    policyAddress: findPolicyPda(owner.publicKey, DEFAULT_AEGIS_PROGRAM_ID),
    addressBook: [],
    tokens: [...DEFAULT_TOKENS],
    intentProviders: [],
    stocksEnabled: true,
    prestocksApiUrl: DEFAULT_PRESTOCKS_API_URL,
    prestocksTimeoutMs: DEFAULT_PRESTOCKS_TIMEOUT_MS,
    stockUniverse: undefined,
    stockDecimals: {},
    stockMints: {},
    scheduleHourUtc: 9,
  };
}

function build() {
  const fake = { async getPolicy() { return policyFixture(); }, async getActionLog() { return []; } };
  return new PraxisServerProvider(config(), fake as unknown as AegisClient);
}

async function reply(provider: PraxisServerProvider, text: string): Promise<AgentBlock[]> {
  const { threadId } = await provider.send(null, text);
  const messages = provider.getThread(threadId)!.messages;
  return messages.filter((m) => m.role === "agent").at(-1)!.blocks;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Only the symbol search is stubbed; nothing here reaches a real network. */
function searchReturning(pairs: unknown[]): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify({ pairs }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof globalThis.fetch;
}

function trumpPairs(count: number) {
  return [
    { chainId: "solana", liquidity: { usd: 31_000_000 }, baseToken: { symbol: "TRUMP", name: "OFFICIAL TRUMP", address: OFFICIAL_TRUMP } },
    { chainId: "solana", liquidity: { usd: 8_000_000 }, baseToken: { symbol: "TRUMP", name: "OFFER TRUTH", address: "5m8k6jHhYFZkiL8FVLFtiu1EEki6HiTbQvLADoUbTJAA" } },
    { chainId: "solana", liquidity: { usd: 1_700_000 }, baseToken: { symbol: "TRUMP", name: "TRUMP", address: "TMPKzJfNTHAUYz7QsaB51pb6Dap5diwTxbUDksj7n8G" } },
  ].slice(0, count);
}

describe("a ticker several mints answer to", () => {
  test("asks which one, with liquidity and a mint on every option", async () => {
    globalThis.fetch = searchReturning(trumpPairs(3));
    const blocks = await reply(build(), "research about trump coin");

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("clarify");
    if (blocks[0].type !== "clarify") return;
    expect(blocks[0].text).toMatch(/3 live Solana tokens trade as \*\*TRUMP\*\*/);
    expect(blocks[0].options[0].label).toBe("TRUMP — OFFICIAL TRUMP");
    expect(blocks[0].options[0].hint).toMatch(/^\$31M liquidity · 6p6xgH…jfGiPN$/);
    // Tapping an option must land on that exact mint, not re-ask the same
    // question by sending the ticker back.
    expect(blocks[0].options[0].value).toBe(`research ${OFFICIAL_TRUMP}`);
  });

  test("the option it offers round-trips into a research request for that mint", async () => {
    globalThis.fetch = searchReturning(trumpPairs(3));
    const provider = build();
    const first = await reply(provider, "research trump");
    if (first[0].type !== "clarify") throw new Error("expected a clarify");

    // Replay the tap. The RPC is unreachable here, so the card degrades —
    // what matters is that it is a card for the chosen mint, not another
    // question.
    globalThis.fetch = searchReturning([]);
    const second = await reply(provider, first[0].options[0].value);
    expect(second[0].type).toBe("research");
    if (second[0].type !== "research") return;
    expect(second[0].data.mint).toBe(OFFICIAL_TRUMP);
  });
});

describe("a ticker only one mint answers to", () => {
  test("goes straight to the card, asking nothing", async () => {
    globalThis.fetch = searchReturning(trumpPairs(1));
    const blocks = await reply(build(), "research about trump coin");
    expect(blocks[0].type).toBe("research");
  });
});

describe("the dead ends", () => {
  test("a name nothing trades under says so, and says what does work", async () => {
    globalThis.fetch = searchReturning([]);
    const blocks = await reply(build(), "research zzzznotacoin");
    expect(blocks[0].type).toBe("clarify");
    if (blocks[0].type !== "clarify") return;
    // Echoed as a ticker, which is the only thing it could have been.
    expect(blocks[0].text).toMatch(/couldn't find a Solana token trading as "ZZZZNOTACOIN"/);
    expect(blocks[0].text).toMatch(/paste the mint address/);
    expect(blocks[0].text).not.toMatch(/Unknown token/);
  });

  test("a pasted mint resolves even with the stock universe on", async () => {
    globalThis.fetch = searchReturning([]);
    const blocks = await reply(build(), `research about ${OFFICIAL_TRUMP}`);
    expect(blocks[0].type).toBe("research");
    if (blocks[0].type !== "research") return;
    expect(blocks[0].data.mint).toBe(OFFICIAL_TRUMP);
  });
});

describe("a reply that throws is still a sentence", () => {
  /**
   * The catch-all used to put `error.message` straight in the chat, so a
   * dropped field surfaced as "intent field recipient must be a non-empty
   * string" and a slow RPC as "... timed out after 8000ms".
   */
  test("a field the parser lost becomes a question naming it", async () => {
    const provider = build();
    // A model returning a transfer with no recipient — the shape the
    // normalizer rejects.
    (provider as unknown as { parseIntent: () => Promise<never> }).parseIntent = async () => {
      const { PraxisInputError } = await import("../../errors");
      throw new PraxisInputError("intent field recipient must be a non-empty string", {
        field: "recipient",
      });
    };
    const blocks = await reply(provider, "send 5 sol");
    expect(blocks[0].type).toBe("clarify");
    if (blocks[0].type !== "clarify") return;
    expect(blocks[0].text).toMatch(/Who should receive it\?/);
    expect(blocks[0].text).not.toMatch(/intent field/);
  });

  test("a timeout names the source, not the milliseconds", async () => {
    const provider = build();
    (provider as unknown as { parseIntent: () => Promise<never> }).parseIntent = async () => {
      throw new Error("Solana token supply lookup timed out after 8000ms");
    };
    const blocks = await reply(provider, "research bonk");
    expect(blocks[0].type).toBe("prose");
    if (blocks[0].type !== "prose") return;
    expect(blocks[0].text).toBe(
      "That took too long — the solana token supply lookup didn't answer. Try again in a moment.",
    );
  });
});
