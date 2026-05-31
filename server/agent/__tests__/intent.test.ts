import { describe, expect, test } from "bun:test";
import { parseIntentLocallyForDemo } from "../intent";

const ADDR = "ALUMw7kSn9xn67suHr2ti21CXBQVNMuRk7uWSM1WuXEt";

describe("deterministic parser — new intents", () => {
  test("standalone save", () => {
    const r = parseIntentLocallyForDemo(`save ${ADDR} as backpack`);
    expect(r.outcome).toBe("actions");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({
      kind: "save_contact",
      address: ADDR,
      label: "backpack",
    });
  });

  test("compound send + save", () => {
    const r = parseIntentLocallyForDemo(`send 0.1 sol to ${ADDR} and save this address as backpack`);
    expect(r.outcome).toBe("actions");
    if (r.outcome !== "actions") throw new Error("expected actions");
    expect(r.actions.map((a) => a.kind)).toEqual(["save_contact", "transfer"]);
    const transfer = r.actions.find((a) => a.kind === "transfer");
    const save = r.actions.find((a) => a.kind === "save_contact");
    expect(transfer && transfer.kind === "transfer" && transfer.recipient).toBe(ADDR);
    expect(save && save.kind === "save_contact" && save.address).toBe(ADDR);
    expect(save && save.kind === "save_contact" && save.label).toBe("backpack");
  });

  test("policy question — general", () => {
    const r = parseIntentLocallyForDemo("how does my policy keep me safe");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({ kind: "policy_question", topic: "general" });
  });

  test("policy question — expiry", () => {
    const r = parseIntentLocallyForDemo("when does my session expire");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({ kind: "policy_question", topic: "expiry" });
  });

  test("plain send still works", () => {
    const r = parseIntentLocallyForDemo("send 0.5 sol to maya");
    expect(r.outcome === "actions" && r.actions[0].kind).toBe("transfer");
  });
});

describe("deterministic parser — policy_change", () => {
  test("change daily limit", () => {
    const r = parseIntentLocallyForDemo("change my daily limit to 10 SOL");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({
      kind: "policy_change",
      field: "daily_limit",
      amountHuman: "10",
    });
  });

  test("raise limit shorthand", () => {
    const r = parseIntentLocallyForDemo("raise the limit to 2.5");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({
      kind: "policy_change",
      field: "daily_limit",
      amountHuman: "2.5",
    });
  });

  test("set max per tx", () => {
    const r = parseIntentLocallyForDemo("set max per tx to 1 sol");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({
      kind: "policy_change",
      field: "max_per_tx",
      amountHuman: "1",
    });
  });

  test("pause the agent", () => {
    const r = parseIntentLocallyForDemo("pause the agent");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({
      kind: "policy_change",
      field: "pause",
      paused: true,
    });
  });

  test("unpause/resume the agent", () => {
    const r = parseIntentLocallyForDemo("resume the agent");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({
      kind: "policy_change",
      field: "pause",
      paused: false,
    });
  });

  test("extend session by hours", () => {
    const r = parseIntentLocallyForDemo("extend my session by 24 hours");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({
      kind: "policy_change",
      field: "expiry",
      expiryHours: 24,
    });
  });

  test("extend session by days converts to hours", () => {
    const r = parseIntentLocallyForDemo("extend my session by 2 days");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({
      kind: "policy_change",
      field: "expiry",
      expiryHours: 48,
    });
  });

  test("a transfer is never misread as a limit change", () => {
    const r = parseIntentLocallyForDemo("send 10 sol to maya");
    expect(r.outcome === "actions" && r.actions[0].kind).toBe("transfer");
  });

  test("asking about the limit stays a question, not a change", () => {
    const r = parseIntentLocallyForDemo("what is my daily limit");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({ kind: "policy_question", topic: "caps" });
  });
});
