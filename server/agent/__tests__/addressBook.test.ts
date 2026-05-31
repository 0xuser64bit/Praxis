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
});
