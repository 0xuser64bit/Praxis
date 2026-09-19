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

describe("deterministic parser — stock intents (C04)", () => {
  test("buy maps to a transfer with the canonical stock symbol", () => {
    const r = parseIntentLocallyForDemo("buy $40 openai for maya");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({
      kind: "transfer",
      asset: "OPENAI",
      amountHuman: "40",
      recipient: "maya",
    });
  });

  test("p-prefix and case are accepted", () => {
    const r = parseIntentLocallyForDemo("buy 2 pSpaceX to maya");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({
      kind: "transfer",
      asset: "SPACEX",
      amountHuman: "2",
      recipient: "maya",
    });
  });

  test("sell maps to a transfer", () => {
    const r = parseIntentLocallyForDemo("sell 5 spacex to maya");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({
      kind: "transfer",
      asset: "SPACEX",
      amountHuman: "5",
      recipient: "maya",
    });
  });

  test("stock research resolves through aliases", () => {
    const r = parseIntentLocallyForDemo("openai price");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({ kind: "research", token: "OPENAI" });
  });

  test("recurring phrasing becomes a schedule (C06: mechanical DCA)", () => {
    const r = parseIntentLocallyForDemo("buy $50 openai every monday");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({
      kind: "schedule_dca",
      asset: "OPENAI",
      amountHuman: "50",
      recipient: undefined,
      cadence: { type: "weekly", weekday: 1 },
    });
  });

  test("recurring phrasing keeps an explicit recipient", () => {
    const r = parseIntentLocallyForDemo("buy $50 openai for maya every monday");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({
      kind: "schedule_dca",
      asset: "OPENAI",
      amountHuman: "50",
      recipient: "maya",
      cadence: { type: "weekly", weekday: 1 },
    });
  });

  test("daily/weekly/monthly shorthands parse", () => {
    const d = parseIntentLocallyForDemo("dca 10 openai daily");
    expect(d.outcome === "actions" && d.actions[0].kind).toBe("schedule_dca");
    const w = parseIntentLocallyForDemo("buy $5 spacex weekly");
    expect(w.outcome === "actions" && w.actions[0]).toMatchObject({ kind: "schedule_dca", asset: "SPACEX" });
    const m = parseIntentLocallyForDemo("buy $5 spacex monthly");
    expect(m.outcome === "actions" && m.actions[0].kind).toBe("schedule_dca");
  });

  test("unknown cadence clarifies instead of scheduling", () => {
    const r = parseIntentLocallyForDemo("buy $50 openai every someday");
    expect(r.outcome).toBe("clarify");
  });

  test("known baskets become one atomic basket action (C06)", () => {
    const a = parseIntentLocallyForDemo("buy ai basket $50");
    expect(a.outcome === "actions" && a.actions[0]).toEqual({
      kind: "basket_buy",
      basket: "ai basket",
      amountHuman: "50",
      recipient: undefined,
    });
    const b = parseIntentLocallyForDemo("buy $100 index for maya");
    expect(b.outcome === "actions" && b.actions[0]).toEqual({
      kind: "basket_buy",
      basket: "index",
      amountHuman: "100",
      recipient: "maya",
    });
  });

  test("unknown baskets clarify with the menu (no invented splits)", () => {
    const r = parseIntentLocallyForDemo("buy mag7 basket $100");
    expect(r.outcome).toBe("clarify");
    expect(r.outcome === "clarify" && r.question).toMatch(/Available: index, ai/);
  });

  test("daily-limit edits still win over the recurring gate", () => {
    const r = parseIntentLocallyForDemo("change my daily limit to 10 SOL");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({
      kind: "policy_change",
      field: "daily_limit",
      amountHuman: "10",
    });
  });
});
