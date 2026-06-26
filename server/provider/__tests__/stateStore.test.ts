import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ActionProposal, ActivityEntry, Thread } from "@praxis/shared";

import { loadProviderState, saveProviderState } from "../stateStore";
import { policyFixture, randomAddress, USDC } from "../../testing/fixtures";

let dir: string;
let prevDir: string | undefined;

beforeAll(() => {
  prevDir = process.env.PRAXIS_STATE_DIR;
  dir = mkdtempSync(join(tmpdir(), "praxis-state-"));
  process.env.PRAXIS_STATE_DIR = dir;
});

afterAll(() => {
  if (prevDir === undefined) delete process.env.PRAXIS_STATE_DIR;
  else process.env.PRAXIS_STATE_DIR = prevDir;
});

function activity(over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: `a-${Math.random()}`,
    kind: "transfer",
    label: "Maya",
    asset: "SOL",
    amount: 500_000_000n,
    decimals: 9,
    result: "allowed",
    ts: 1000,
    ...over,
  };
}

function proposal(id: string): ActionProposal {
  return {
    id,
    detail: { kind: "transfer", amount: 1n, asset: USDC, recipientName: "Maya", recipientAddress: randomAddress() },
    networkFee: 5000n,
    simulation: "ok",
    check: { allowed: true, spentToday: 0n, dailyLimit: 10n, remaining: 10n },
    state: "pending",
  };
}

function threadReferencing(proposalId: string): Thread {
  return {
    id: `t-${proposalId}`,
    title: "Send",
    updatedAt: 2000,
    messages: [
      { id: "m1", role: "user", ts: 1999, text: "send" },
      { id: "m2", role: "agent", ts: 2000, blocks: [{ type: "proposal", text: "x", proposalId }] },
    ],
  };
}

describe("stateStore persistence", () => {
  test("round-trips threads, proposals, and bigint money fields", () => {
    const owner = randomAddress();
    const referenced = proposal("p-keep");
    saveProviderState(owner, {
      threads: [threadReferencing("p-keep")],
      proposals: { "p-keep": referenced },
      activity: [activity({ amount: 123_456_789n })],
      contacts: [],
    });

    const loaded = loadProviderState(owner);
    expect(loaded?.activity[0].amount).toBe(123_456_789n);
    expect(typeof loaded?.activity[0].amount).toBe("bigint");
    const detail = loaded?.proposals["p-keep"].detail;
    expect(detail?.kind).toBe("transfer");
    if (detail?.kind === "transfer") expect(detail.amount).toBe(1n);
  });

  test("drops proposals not referenced by any thread (orphan GC)", () => {
    const owner = randomAddress();
    saveProviderState(owner, {
      threads: [threadReferencing("p-keep")],
      proposals: { "p-keep": proposal("p-keep"), "p-orphan": proposal("p-orphan") },
      activity: [],
      contacts: [],
    });
    const loaded = loadProviderState(owner);
    expect(loaded?.proposals["p-keep"]).toBeDefined();
    expect(loaded?.proposals["p-orphan"]).toBeUndefined();
  });

  test("caps threads at 50 newest and activity at 250 newest", () => {
    const owner = randomAddress();
    const threads: Thread[] = Array.from({ length: 60 }, (_, i) => ({
      id: `t-${i}`,
      title: `T${i}`,
      messages: [],
      updatedAt: i,
    }));
    const acts = Array.from({ length: 400 }, (_, i) => activity({ id: `a-${i}`, ts: i }));
    saveProviderState(owner, { threads, proposals: {}, activity: acts, contacts: [] });

    const loaded = loadProviderState(owner);
    expect(loaded?.threads).toHaveLength(50);
    expect(loaded?.threads[0].updatedAt).toBe(59); // newest first
    expect(loaded?.activity).toHaveLength(250);
    expect(loaded?.activity[0].ts).toBe(399);
  });

  test("returns undefined for an unknown owner", () => {
    expect(loadProviderState(randomAddress())).toBeUndefined();
  });

  test("ignores a file with a mismatched version", () => {
    const owner = randomAddress();
    saveProviderState(owner, { threads: [], proposals: {}, activity: [], contacts: [] });
    const file = join(dir, `${owner}.json`);
    writeFileSync(file, JSON.stringify({ version: 99, ownerKey: owner, state: {} }));
    expect(loadProviderState(owner)).toBeUndefined();
  });

  test("ignores a file whose ownerKey does not match", () => {
    const owner = randomAddress();
    const file = join(dir, `${owner.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
    writeFileSync(file, JSON.stringify({ version: 1, ownerKey: "someone-else", state: { threads: [] } }));
    expect(loadProviderState(owner)).toBeUndefined();
  });

  test("policy fixture stays out of persisted state (policy is chain-sourced)", () => {
    // sanity: saveProviderState only persists threads/proposals/activity.
    const owner = randomAddress();
    saveProviderState(owner, { threads: [], proposals: {}, activity: [], contacts: [] });
    const loaded = loadProviderState(owner) as unknown as Record<string, unknown>;
    expect(loaded.policy).toBeUndefined();
    expect(policyFixture().address).toBeDefined();
  });
});
