/**
 * Live PreStocks API check (read-only, needs network).
 *
 * Asserts the API still matches the universe the product pins in
 * `server/stocks/universe.ts`: an array of entries, all 8 symbols present with
 * the pinned mints and positive token/mark prices. Flags (without failing)
 * core fields that drifted out of the response. Network failure is an honest
 * exit 1, not a silent pass.
 *
 * Run: `bun run praxis:stockscheck`
 */

import { STOCK_LIST } from "../server/stocks/universe";

const API_URL = process.env.PRAXIS_PRESTOCKS_API_URL?.trim() || "https://prestocks.com/api/prestocks";
const TIMEOUT_MS = Number(process.env.PRAXIS_PRESTOCKS_TIMEOUT_MS ?? 8000);

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`│   ✓ ${label}${detail ? `  ↳ ${detail}` : ""}`);
  else {
    failures++;
    console.log(`│   ✗ ${label}  ↳ FAILED ${detail}`);
  }
}

function isPlausibleMint(s: unknown): s is string {
  return typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

async function fetchJson(url: string, ms: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log("┌──── PRESTOCKS API CHECK ──────────────────────────────────────────────────");
  console.log(`│ API: ${API_URL}`);

  let body: unknown;
  try {
    body = await fetchJson(API_URL, TIMEOUT_MS);
  } catch (error) {
    console.log(`│   ✗ fetch failed  ↳ ${error instanceof Error ? error.message : String(error)}`);
    console.log("└───────────────────────────────────────────────────────────────────────────");
    console.log("\nSTOCKSCHECK: FAIL ❌ — PreStocks API unreachable (honest failure, no fallback asserted).");
    process.exit(1);
  }

  assert("response is an array", Array.isArray(body), Array.isArray(body) ? `${(body as unknown[]).length} entries` : typeof body);
  const entries = (Array.isArray(body) ? body : []) as Array<Record<string, unknown>>;
  const bySymbol = new Map(entries.map((e) => [String(e.symbol ?? "").toUpperCase(), e]));

  for (const { symbol, mint } of STOCK_LIST) {
    const e = bySymbol.get(symbol);
    assert(`${symbol} present`, Boolean(e));
    if (!e) continue;
    assert(`${symbol} mint matches universe`, e.contract_address === mint, String(e.contract_address ?? ""));
    assert(`${symbol} mint plausible base58`, isPlausibleMint(e.contract_address));
    const tp = Number(e.tokenPrice);
    const mp = Number(e.markPrice);
    assert(`${symbol} tokenPrice > 0`, Number.isFinite(tp) && tp > 0, `tokenPrice=${String(e.tokenPrice)}`);
    assert(`${symbol} markPrice > 0`, Number.isFinite(mp) && mp > 0, `markPrice=${String(e.markPrice)}`);
  }

  // Shape drift detector: flag unknown/missing core fields without failing the gate.
  const CORE = ["symbol", "contract_address", "tokenPrice", "markPrice", "supply", "external_url"];
  const sample = entries[0] ?? {};
  for (const k of CORE) {
    if (!(k in sample)) console.log(`│   ! drift: core field "${k}" missing from API sample`);
  }

  console.log("└───────────────────────────────────────────────────────────────────────────");
  if (failures === 0) {
    console.log("\nSTOCKSCHECK: PASS ✅");
    process.exit(0);
  }
  console.log(`\nSTOCKSCHECK: FAIL ❌ — ${failures} assertion(s) failed.`);
  process.exit(1);
}

void main();
