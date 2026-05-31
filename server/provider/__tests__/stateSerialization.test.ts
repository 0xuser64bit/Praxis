import { describe, expect, test } from "bun:test";
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
});
