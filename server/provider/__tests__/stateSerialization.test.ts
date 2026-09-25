import { describe, expect, test } from "bun:test";

import type { ActionProposal } from "@praxis/shared";
import { compactState, normalizeStoredState, type StoredProviderState } from "../stateSerialization";
const base: StoredProviderState = { threads: [], proposals: {}, activity: [], contacts: [] };

describe("stateSerialization contacts", () => {
  test("normalizeStoredState defaults contacts to [] when missing", () => {
    const out = normalizeStoredState({ threads: [], proposals: {}, activity: [] });
    expect(out?.contacts).toEqual([]);
  });

  test("normalizeStoredState keeps a contacts array", () => {
    const contacts = [{ label: "bp", name: "bp", address: "ALUMw7kSn9xn67suHr2ti21CXBQVNMuRk7uWSM1WuXEt" }];
    const out = normalizeStoredState({ ...base, contacts });
    expect(out?.contacts).toEqual(contacts);
  });

  test("compactState preserves contacts", () => {
    const contacts = [{ label: "bp", name: "bp", address: "ALUMw7kSn9xn67suHr2ti21CXBQVNMuRk7uWSM1WuXEt" }];
    expect(compactState({ ...base, contacts }).contacts).toEqual(contacts);
  });

  test("compactState retains an unresolved proposal without its thread", () => {
    const proposal = {
      id: "p-unknown",
      detail: { kind: "transfer", amount: 1n, asset: { symbol: "SOL", mint: "11111111111111111111111111111111", decimals: 9, verified: true }, recipientName: "Maya", recipientAddress: "ALUMw7kSn9xn67suHr2ti21CXBQVNMuRk7uWSM1WuXEt" },
      networkFee: 1n,
      simulation: "Submitted",
      check: { allowed: true, spentToday: 0n, dailyLimit: 1n, remaining: 1n },
      state: "submitted",
      sig: "sig-unknown",
    } as ActionProposal;
    const out = compactState({ ...base, proposals: { [proposal.id]: proposal } });
    expect(out.proposals[proposal.id]?.state).toBe("submitted");
  });
});
