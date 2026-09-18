/**
 * C01 — PreStocks spike (read-only, no product change).
 *
 * Proves the PreStocks API shape the integration spec depends on
 * (docs/PRESTOCKS.md §1) and records the transfer-only vs swap decision input:
 *   - API reachable, array of entries with symbol + contract_address + prices
 *   - all 8 expected pre-IPO symbols present with plausible mints + prices
 *
 * Decimals / Jupiter routability are probed best-effort and reported, never
 * asserted — they are open questions until a funded-RPC spike resolves them.
 * Network failure is an honest exit 1, not a silent pass.
 *
 * Run: `bun run praxis:stockscheck`
 */

const API_URL = process.env.PRAXIS_PRESTOCKS_API_URL?.trim() || "https://prestocks.com/api/prestocks";
const TIMEOUT_MS = Number(process.env.PRAXIS_PRESTOCKS_TIMEOUT_MS ?? 8000);

const EXPECTED: Array<{ symbol: string; mint: string }> = [
  { symbol: "ANDURIL", mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB" },
  { symbol: "ANTHROPIC", mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw" },
  { symbol: "FIGUREAI", mint: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd" },
  { symbol: "KALSHI", mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua" },
  { symbol: "NEURALINK", mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S" },
  { symbol: "OPENAI", mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF" },
  { symbol: "POLYMARKET", mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP" },
  { symbol: "SPACEX", mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh" },
];

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
  console.log("┌──── PRESTOCKS SPIKE (C01, read-only) ─────────────────────────────────────");
  console.log(`│ API: ${API_URL}`);

  let body: unknown;
  try {
    body = await fetchJson(API_URL, TIMEOUT_MS);
  } catch (error) {
    console.log(`│   ✗ fetch failed  ↳ ${error instanceof Error ? error.message : String(error)}`);
    console.log("└───────────────────────────────────────────────────────────────────────────");
    console.log("\nSTOCKS SPIKE: FAIL ❌ — PreStocks API unreachable (honest failure, no fallback asserted).");
    process.exit(1);
  }

  assert("response is an array", Array.isArray(body), Array.isArray(body) ? `${(body as unknown[]).length} entries` : typeof body);
  const entries = (Array.isArray(body) ? body : []) as Array<Record<string, unknown>>;
  const bySymbol = new Map(entries.map((e) => [String(e.symbol ?? "").toUpperCase(), e]));

  for (const { symbol, mint } of EXPECTED) {
    const e = bySymbol.get(symbol);
    assert(`${symbol} present`, Boolean(e));
    if (!e) continue;
    assert(`${symbol} mint matches spec`, e.contract_address === mint, String(e.contract_address ?? ""));
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

  console.log("│");
  console.log("│ Open questions (not asserted, resolve with funded RPC): decimals per mint,");
  console.log("│ DexScreener liquidity, Jupiter USDC->mint routability. Default: transfer-only.");
  console.log("└───────────────────────────────────────────────────────────────────────────");
  if (failures === 0) {
    console.log("\nSTOCKS SPIKE: PASS ✅");
    process.exit(0);
  }
  console.log(`\nSTOCKS SPIKE: FAIL ❌ — ${failures} assertion(s) failed.`);
  process.exit(1);
}

void main();
