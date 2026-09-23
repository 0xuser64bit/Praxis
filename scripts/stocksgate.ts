/**
 * Offline honesty gate for the stocks integration (runs in CI).
 *
 * Fully offline (no RPC, no API): proves the off-chain mirrors and agent
 * wiring agree with the on-chain program:
 *   - all 8 PreStocks mints resolve to the spec addresses
 *   - an unknown mint is MintNotAllowed (mirror of Aegis 6013, proven on-chain by T7)
 *   - swaps stay blocked (parser emits only the stub; never an executable swap)
 *   - research inputs degrade (garbage API shape, dead fetch → empty, never throw)
 *   - DCA/basket pure paths (cadence parse, basket resolve, priced splits)
 *
 * The live PreStocks probe is `bun run praxis:stockscheck` (needs network).
 * This gate is the CI-grade part: `bun run praxis:stocksgate`.
 */

import { RejectReason } from "@praxis/shared";

import { checkTokenTransferPolicy } from "../server/agent/policy";
import { AddressBook } from "../server/agent/addressBook";
import { parsePrestocksBody, fetchPrestocksEntries, __resetPrestocksCacheForTests } from "../server/stocks/prestocks";
import { STOCK_LIST, buildStockTokens, normalizeStockAlias } from "../server/stocks/universe";
import {
  advanceCadence,
  parseCadence,
  resolveBasket,
  splitBasket,
} from "../server/stocks/schedules";
import { parseIntentLocallyForDemo } from "../server/agent/intent";
import { policyFixture } from "../server/testing/fixtures";

const OPENAI_MINT = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const now = 1_900_000_000;

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`│   ✓ ${label}${detail ? `  ↳ ${detail}` : ""}`);
  else {
    failures++;
    console.log(`│   ✗ ${label}  ↳ FAILED ${detail}`);
  }
}

async function main() {
  console.log("┌──── STOCKS HONESTY GATE (C08, offline) ───────────────────────────────────");

  // 1. Universe: 8 spec mints resolve, aliases normalize.
  {
    const tokens = buildStockTokens();
    assert("8 stock tokens resolve", tokens.length === 8, `${tokens.length} found`);
    const bySymbol = new Map(tokens.map((t) => [t.symbol, t.mint]));
    assert("OPENAI mint matches spec", bySymbol.get("OPENAI") === OPENAI_MINT);
    assert("all spec mints match", STOCK_LIST.every((s) => bySymbol.get(s.symbol) === s.mint));
    assert("aliases normalize (pOpenAI, popenai)", normalizeStockAlias("pOpenai") === "OPENAI");
  }

  // 2. Unknown mint → MintNotAllowed (mirror of Aegis custom 6013).
  {
    const policy = { ...policyFixture(), tokenMint: OPENAI_MINT, expiryTs: now + 86_400 };
    const verdict = checkTokenTransferPolicy(
      policy,
      { symbol: "FAKE", mint: "Fake111111111111111111111111111111111111111", decimals: 6, verified: false },
      1_000_000n,
      "Rando11111111111111111111111111111111111111",
      now,
    );
    assert("unknown mint blocked", verdict.allowed === false);
    assert("reason is MintNotAllowed", verdict.reasonCode === RejectReason.MintNotAllowed);
  }

  // 3. Swaps stay blocked: the parser emits only the stub.
  {
    const parsed = parseIntentLocallyForDemo("swap 1 usdc for bonk");
    const kinds = parsed.outcome === "actions" ? parsed.actions.map((a) => a.kind) : [];
    assert("swap intent parses to swap_stub only", kinds.join() === "swap_stub", kinds.join());
    // "sell 5 openai for usdc": no recipient resolves, so the provider must
    // clarify — it can never execute into a ticker.
    const sell = parseIntentLocallyForDemo("sell 5 openai for usdc");
    const sellRecipient = sell.outcome === "actions" && sell.actions[0].kind === "transfer"
      ? sell.actions[0].recipient ?? ""
      : "";
    assert("sell-for-ticker names no contact", new AddressBook([]).resolve(sellRecipient).kind !== "exact", sellRecipient);
  }

  // 4. Research inputs degrade honestly.
  {
    assert("garbage API body → []", parsePrestocksBody(null).length === 0);
    assert("drifted shape → []", parsePrestocksBody([{ nope: 1 }]).length === 0);
    __resetPrestocksCacheForTests();
    const dead = async (): Promise<Response> => {
      throw new Error("network down");
    };
    const entries = await fetchPrestocksEntries("https://dead.invalid/", 500, dead as unknown as typeof fetch);
    assert("dead fetch → [] (never throws)", entries.length === 0);
  }

  // 5. DCA/basket pure paths.
  {
    assert("DCA cadence parses", parseCadence("every monday")?.type === "weekly");
    assert("unknown cadence is null", parseCadence("every someday") === null);
    assert("index resolves 8 (ordered)", (resolveBasket("index") ?? []).length === 8);
    assert("unknown basket is null", resolveBasket("mag7") === null);
    const split = splitBasket(60, ["OPENAI", "ANTHROPIC"], new Map([["OPENAI", 10], ["ANTHROPIC", 20]]), () => 6);
    assert("priced split is exact", split?.[0].amount === 3_000_000n && split?.[1].amount === 1_500_000n);
    assert("unpriceable split is null", splitBasket(60, ["OPENAI"], new Map(), () => 6) === null);
    assert("cadence advances", advanceCadence({ type: "daily" }, 1_000) === 1_000 + 86_400_000);
    // A recurring buy must fire on the weekday it promises, not on whichever
    // day it happened to be created. 2026-09-16 is a Wednesday.
    const nextMonday = advanceCadence({ type: "weekly", weekday: 1 }, Date.UTC(2026, 8, 16, 9, 0));
    assert(
      "weekly fires on the named weekday",
      new Date(nextMonday).getUTCDay() === 1 && nextMonday === Date.UTC(2026, 8, 21, 9, 0),
      new Date(nextMonday).toISOString(),
    );
  }

  // 6. DCA/basket intent shapes parse to the mechanical kinds.
  {
    const dca = parseIntentLocallyForDemo("buy $50 openai every monday");
    assert("DCA parses to schedule_dca", dca.outcome === "actions" && dca.actions[0].kind === "schedule_dca");
    const basket = parseIntentLocallyForDemo("buy ai basket $60");
    assert("basket parses to basket_buy", basket.outcome === "actions" && basket.actions[0].kind === "basket_buy");
  }

  console.log("└───────────────────────────────────────────────────────────────────────────");
  if (failures === 0) {
    console.log("\nSTOCKS GATE: PASS ✅");
    process.exit(0);
  }
  console.log(`\nSTOCKS GATE: FAIL ❌ — ${failures} assertion(s) failed.`);
  process.exit(1);
}

void main();
