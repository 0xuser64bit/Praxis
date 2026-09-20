import { afterEach, describe, expect, test } from "bun:test";

import type { PraxisServerConfig } from "../../env";
import { parseIntentLocallyForDemo, parseIntentWithGemini } from "../intent";

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
      // The "$" is a quantity here, not a unit — recorded so the reply can
      // say so rather than leaving the reader to spot it on the card.
      usdSigil: true,
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

describe("recurring-buy phrasing order", () => {
  /**
   * The recipient reads naturally on either side of the cadence. Only one
   * order used to parse, so half the phrasings fell through to a clarify and
   * the feature looked broken.
   */
  const shapes = [
    "buy 10 openai every monday for maya",
    "buy 10 openai for maya every monday",
  ];

  for (const line of shapes) {
    test(`"${line}" schedules for maya every Monday`, () => {
      const parsed = parseIntentLocallyForDemo(line);
      expect(parsed.outcome).toBe("actions");
      if (parsed.outcome !== "actions") return;
      const action = parsed.actions[0];
      expect(action.kind).toBe("schedule_dca");
      if (action.kind !== "schedule_dca") return;
      expect(action.asset).toBe("OPENAI");
      expect(action.amountHuman).toBe("10");
      expect(action.recipient).toBe("maya");
      expect(action.cadence).toEqual({ type: "weekly", weekday: 1 });
    });
  }

  test("no recipient still schedules", () => {
    const parsed = parseIntentLocallyForDemo("buy $50 spacex every monday");
    expect(parsed.outcome).toBe("actions");
    if (parsed.outcome !== "actions") return;
    const action = parsed.actions[0];
    expect(action.kind).toBe("schedule_dca");
    if (action.kind !== "schedule_dca") return;
    expect(action.recipient).toBeUndefined();
  });
});

/**
 * A one-off buy with no recipient.
 *
 * `buy $40 openai` is the phrasing the README and the submission doc lead
 * with, and it used to clarify — while `buy $50 spacex every monday`, the same
 * intent on a schedule, went straight through by defaulting the recipient to
 * the owner's own wallet. Two answers for one sentence.
 */
describe("bare buy — no recipient named", () => {
  test("buy $40 openai settles into the owner's own wallet", () => {
    const parsed = parseIntentLocallyForDemo("buy $40 openai");
    expect(parsed.outcome).toBe("actions");
    if (parsed.outcome !== "actions") return;
    expect(parsed.actions[0]).toEqual({
      kind: "transfer",
      asset: "OPENAI",
      amountHuman: "40",
      toSelf: true,
      usdSigil: true,
    });
  });

  test("a named recipient still wins", () => {
    const parsed = parseIntentLocallyForDemo("buy $40 openai for maya");
    expect(parsed.outcome).toBe("actions");
    if (parsed.outcome !== "actions") return;
    const action = parsed.actions[0];
    expect(action.kind).toBe("transfer");
    if (action.kind !== "transfer") return;
    expect(action.recipient).toBe("maya");
    expect(action.toSelf).toBeUndefined();
  });

  test("p-prefixed and 'of' phrasing land on the same symbol", () => {
    for (const line of ["buy 10 popenai", "purchase $10 of openai"]) {
      const parsed = parseIntentLocallyForDemo(line);
      expect(parsed.outcome).toBe("actions");
      if (parsed.outcome !== "actions") continue;
      const action = parsed.actions[0];
      expect(action.kind).toBe("transfer");
      if (action.kind !== "transfer") continue;
      expect(action.asset).toBe("OPENAI");
      expect(action.toSelf).toBe(true);
    }
  });

  test("a send with no recipient is still a question, never a self-send", () => {
    // The verb is what makes the default safe. "send 0.5 sol" is a sentence
    // with a word missing; guessing that the missing word is "me" is exactly
    // the guess this parser refuses to make.
    const parsed = parseIntentLocallyForDemo("send 0.5 sol");
    const selfTransfer =
      parsed.outcome === "actions" &&
      parsed.actions.some((a) => a.kind === "transfer" && a.toSelf === true);
    expect(selfTransfer).toBe(false);
  });

  test("a bare sell is not a transfer to yourself", () => {
    // Selling means swapping for something. A self-transfer of the thing you
    // were trying to sell is not a sale.
    const parsed = parseIntentLocallyForDemo("sell 40 openai");
    const selfTransfer =
      parsed.outcome === "actions" &&
      parsed.actions.some((a) => a.kind === "transfer" && a.toSelf === true);
    expect(selfTransfer).toBe(false);
  });

  test("recurring and basket phrasing keep their meaning", () => {
    const schedule = parseIntentLocallyForDemo("buy $50 spacex every monday");
    expect(schedule.outcome === "actions" && schedule.actions[0].kind).toBe("schedule_dca");

    const basket = parseIntentLocallyForDemo("buy $100 index");
    expect(basket.outcome === "actions" && basket.actions[0].kind).toBe("basket_buy");
  });
});

/**
 * The model path. `toSelf` must be something the model SAYS, never something
 * inferred from a field it forgot: a dropped recipient on "send 5 SOL to alex"
 * has to stay a clarification, not become a transfer to yourself.
 */
describe("LLM path — toSelf is explicit, never inferred", () => {
  const config = { geminiApiKey: "test-key" } as unknown as PraxisServerConfig;

  function geminiReturning(args: unknown): typeof globalThis.fetch {
    return (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ functionCall: { name: "parse_praxis_intent", args } }] } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof globalThis.fetch;
  }

  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("a buy that declares toSelf parses with no recipient", async () => {
    globalThis.fetch = geminiReturning({
      outcome: "actions",
      actions: [{ kind: "transfer", asset: "OPENAI", amountHuman: "40", toSelf: true }],
    });
    const parsed = await parseIntentWithGemini("buy $40 openai", config);
    expect(parsed.outcome).toBe("actions");
    if (parsed.outcome !== "actions") return;
    expect(parsed.actions[0]).toEqual({
      kind: "transfer",
      asset: "OPENAI",
      amountHuman: "40",
      toSelf: true,
    });
  });

  test("a transfer that merely omits the recipient is rejected", async () => {
    globalThis.fetch = geminiReturning({
      outcome: "actions",
      actions: [{ kind: "transfer", asset: "SOL", amountHuman: "5" }],
    });
    // Rejected here means the caller surfaces an error rather than moving
    // 5 SOL to a destination nobody named.
    await expect(parseIntentWithGemini("send 5 sol to alex", config)).rejects.toThrow(
      /recipient/i,
    );
  });
});

/**
 * The dollar sign is not a unit. "$40 openai" moves 40 OPENAI, which at a
 * three-figure share price is two hundred times $40 — so the sigil is carried
 * through the parse instead of being dropped at the regex, and the reply says
 * which reading it took.
 */
describe("the $ sigil is recorded, not silently discarded", () => {
  test("a dollar amount parses as a quantity and says so", () => {
    const parsed = parseIntentLocallyForDemo("buy $40 openai");
    expect(parsed.outcome).toBe("actions");
    if (parsed.outcome !== "actions") return;
    const action = parsed.actions[0];
    expect(action.kind).toBe("transfer");
    if (action.kind !== "transfer") return;
    expect(action.amountHuman).toBe("40");
    expect(action.usdSigil).toBe(true);
  });

  test("no sigil, no note", () => {
    const parsed = parseIntentLocallyForDemo("buy 40 openai");
    expect(parsed.outcome === "actions" && parsed.actions[0].kind === "transfer").toBe(true);
    if (parsed.outcome !== "actions") return;
    const action = parsed.actions[0];
    expect(action.kind === "transfer" && action.usdSigil).toBeUndefined();
  });

  test("a named-recipient send records it too", () => {
    const parsed = parseIntentLocallyForDemo("send $5 sol to maya");
    if (parsed.outcome !== "actions") throw new Error("expected actions");
    const action = parsed.actions[0];
    expect(action.kind === "transfer" && action.usdSigil).toBe(true);
    expect(action.kind === "transfer" && action.amountHuman).toBe("5");
  });
});
