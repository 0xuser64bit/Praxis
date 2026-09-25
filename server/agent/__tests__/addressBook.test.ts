import { describe, expect, test } from "bun:test";
import { AddressBook } from "../addressBook";

const ADDR = "ALUMw7kSn9xn67suHr2ti21CXBQVNMuRk7uWSM1WuXEt";
const ADDR2 = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

describe("AddressBook saved contacts", () => {
  test("add() upserts and is resolvable by label", () => {
    const book = new AddressBook([]);
    book.add({ label: "backpack", name: "backpack", address: ADDR });
    const r = book.resolve("backpack");
    expect(r.kind).toBe("exact");
    expect(r.kind === "exact" && r.entry.address).toBe(ADDR);
  });

  test("a pasted address that matches a saved contact resolves to that contact", () => {
    const book = new AddressBook([{ label: "backpack", name: "Backpack Wallet", address: ADDR }]);
    const r = book.resolve(ADDR);
    expect(r.kind === "exact" && r.entry.name).toBe("Backpack Wallet");
  });

  test("ambiguous labels produce address-specific continuation values", () => {
    const book = new AddressBook([
      { label: "alex", name: "Alex Kim", address: ADDR },
      { label: "alex", name: "Alex Rivera", address: ADDR2 },
    ]);
    const result = book.resolve("alex");
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    expect(result.options.map((option) => option.value)).toEqual([ADDR, ADDR2]);
  });

  test("an unknown pasted address resolves as a one-off pasted address", () => {
    const book = new AddressBook([]);
    const r = book.resolve(ADDR2);
    expect(r.kind === "exact" && r.entry.label).toBe("pasted-address");
  });

  test("add() dedupes by address (newest label wins)", () => {
    const book = new AddressBook([{ label: "old", name: "old", address: ADDR }]);
    book.add({ label: "backpack", name: "backpack", address: ADDR });
    expect(book.all().filter((e) => e.address === ADDR)).toHaveLength(1);
    expect(book.resolve("backpack").kind).toBe("exact");
  });

  test("remove() drops by address or label (case-insensitive) and returns the removed", () => {
    const book = new AddressBook([
      { label: "backpack", name: "Backpack Wallet", address: ADDR },
      { label: "vault", name: "Vault", address: ADDR2 },
    ]);
    expect(book.remove("BACKPACK")).toHaveLength(1);
    expect(book.all().some((e) => e.address === ADDR)).toBe(false);
    expect(book.remove(ADDR2)).toHaveLength(1);
    expect(book.all()).toHaveLength(0);
  });

  test("remove() is a no-op on unknown or blank keys", () => {
    const book = new AddressBook([{ label: "backpack", name: "Backpack Wallet", address: ADDR }]);
    expect(book.remove("nobody")).toEqual([]);
    expect(book.remove("   ")).toEqual([]);
    expect(book.all()).toHaveLength(1);
  });
});
