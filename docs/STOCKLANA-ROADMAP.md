# Stocklana roadmap — commit-by-commit plan

Date: 2026-09-18 · Deadline: Fri 25 Sep 4pm ET · Branch strategy: `stocklana` feature branch, squash-free small commits, PR into `main` only after green verify.
Parent: [STOCKLANA.md](./STOCKLANA.md) · Spec: [PRESTOCKS.md](./PRESTOCKS.md)

How to use this doc with coding agents: each `Cxx` is one commit. Do them in order.
Every commit lists entry criteria, files, exit criteria, and the exact verify command.
Never skip verification. Never mix two commits in one diff. ~~Never touch
`aegis/programs/**` in C01–C10~~ — superseded by C11 (the mints turned out to
be Token-2022; see below).

Global verify (every commit): `bun run lint && bun run test && bun run build`
Program gate (must stay green): `bun run aegis:test` — T1–T9.

---

## C00 — Docs foundation (this commit)

Entry: main green. Exit: STOCKLANA.md + PRESTOCKS.md + this file merged.
Files: `docs/STOCKLANA.md`, `docs/PRESTOCKS.md`, `docs/STOCKLANA-ROADMAP.md`
Verify: markdown only; `git status` clean after commit.

## C01 — PreStocks spike (read-only, no product change)

Goal: resolve PRESTOCKS.md §1 open questions with evidence, not guesses.
- Probe `GET $PRAXIS_PRESTOCKS_API_URL` (default prestocks.com/api/prestocks): latency, shape drift vs spec.
- For each of 8 mints: `getTokenSupply` (decimals) on research RPC + DexScreener pairs + Jupiter quote `USDC -> mint` ($10).
- Record: decimals, liquidity present/absent, routable yes/no, tokenPrice vs markPrice note.
- Output: `docs/PRESTOCKS-SPIKE.md` (table + raw evidence links) + `scripts/stockscheck.ts` skeleton that prints the table (exit 0 when API reachable, exit 1 with honest message when not).

Files: `docs/PRESTOCKS-SPIKE.md`, `scripts/stockscheck.ts`, `package.json` (add `praxis:stockscheck` script only).
Exit: `bun run praxis:stockscheck` runs; no behavior change to app/SDK.
Decision gate at end of C01: transfer-only (likely) vs swap-route exists. Write the decision into the spike doc; C04+ follows it.

## C02 — Stock universe config (flagged off by default)

Goal: token registry seam without changing default behavior.
- Add env: `PRAXIS_STOCKS_ENABLED`, `PRAXIS_PRESTOCKS_API_URL`, `PRAXIS_PRESTOCKS_TIMEOUT_MS`, `PRAXIS_STOCK_UNIVERSE` (PRESTOCKS.md §2).
- Add `server/stocks/universe.ts`: `STOCK_SYMBOLS`, `STOCK_MINTS` (8 addresses from spec), `isStockSymbol()`, `normalizeStockAlias()` (`pOpenAI` -> `OPENAI`), `stockTokens(decimalsMap)` builder.
- Wire into `server/env.ts:parseTokens` additively: when flag on, merge stock tokens; when off, identical to today.
- `.env.example` documents new vars (commented defaults).
- Unit tests: alias normalization, flag-off parity (token list unchanged), flag-on merge (8 added, verified=true).

Files: `server/stocks/universe.ts`, `server/stocks/__tests__/universe.test.ts`, `server/env.ts`, `.env.example`
Exit: flag off -> `bun run test` identical behavior; flag on -> 8 mints present. `bun run lint && bun run test` green.

## C03 — Research adapter (PreStocks-first, honest fallback)

Goal: `research openai` shows PreStocks data; failures degrade, never lie.
- Add `server/stocks/prestocks.ts`: `fetchPrestocks(timeoutMs)` with 60s in-memory cache, zod-loose parsing (unknown fields tolerated), timeout + non-2xx -> `[]`.
- Add `mergeStockResearch()` pure function (PRESTOCKS.md §3 rule 5).
- Extend `server/agent/research.ts` to call it when symbol is a stock and flag is on; keep existing RPC + DexScreener path untouched otherwise.
- Attribution + risk line in summary; `external_url` surfaced in research block data.
- Tests: merge matrix (both present / prestocks-only / indexer-only / all-empty), timeout degrades, summary contains no advice verbs.

Files: `server/stocks/prestocks.ts`, `server/stocks/__tests__/prestocks.test.ts`, `server/agent/research.ts`, `server/agent/__tests__/*` (extend)
Exit: `research openai` (flag on) renders tokenPrice + markPrice rows; flag off unchanged. Full verify green.

## C04 — Intent: stock synonyms (transfer + DCA + basket phrasing)

Goal: users can say `buy / sell / dca / basket` and get typed actions, no new instruction.
- Extend `TOKEN_ALIASES` + `matchResearch` for 8 stock symbols + `p`-prefix.
- Deterministic parser: `buy/sell $X <stock> [for <recipient>]`, `buy $X <stock> every <cadence>`, `buy <basket> $X`.
- Gemini `INTENT_SYSTEM_PROMPT`: stock alias list + same synonyms + basket decomposition rule (one `transfer` per constituent, order stable).
- `normalizeAction` unchanged (still `transfer`); DCA cadence + basket id travel as proposal metadata, not new kinds.
- Tests: parser matrix for C04 table in PRESTOCKS.md §4, compound `buy + save`, clarify on ambiguous amount/recipient.

Files: `server/agent/intent.ts`, `server/agent/__tests__/intent.*` (extend)
Exit: `$0` demo (`PRAXIS_LOCAL_INTENT=1`) handles `buy $40 openai`, `buy $50 openai every monday`, `buy mag7 basket $100`. Verify green.

## C05 — One-policy-per-stock UX (no program change)

Goal: make the single-mint constraint legible instead of painful.
- Policy switcher: active-stock selector in `/app` + `get-policy?mint=` passthrough (server derives same PDA scheme, client labels `OPENAI vault · policy i of n`).
- `configureToken` + `prepareTokenAccounts` flows reused per stock; empty-state copy explains one-vault-per-stock + portfolio-cap-is-display-only.
- Address-book + activity views filter by active mint; ActionLog mint already present.
- Tests: policy derivation stable per mint, UI shows correct mint + caps, switching never mixes `spentToday` counters.

Files: `components/app/*`, `app/api/praxis/*` (read path only), `server/provider/praxisServer.ts` (read path)
Exit: manual devnet: 2 stocks configured, switching shows independent caps. Verify green.

## C06 — Buy / DCA / basket proposal flow (mechanical, same checks)

Goal: recurring + basket buys emit the same proposal + `checkTokenTransferPolicy` path as one-off buys.
- DCA scheduler: `app/api/cron/stocks/route.ts` (Vercel cron or `bun scripts/stocks-dca.ts` for demo) — reads schedule store, calls same `blocksForIntent` transfer builder per fire, same policy check, no auto-sign (user confirms each fire in MVP; auto-sign explicitly out).
- Basket: ordered transfers, per-constituent proposal, all-or-clarify if any constituent blocked (never partial-sign silently).
- Store: `StoredProviderState.schedules` (Postgres + fs, same pattern as `contacts`).
- Tests: schedule fires -> proposals with correct amounts/mints; blocked constituent blocks whole basket with clear copy.

Files: `server/stocks/schedules.ts`, `app/api/cron/stocks/route.ts`, `scripts/stocks-dca.ts`, state serialization + tests
Exit: `buy $50 openai every monday` creates schedule; cron dry-run emits proposal; basket of 2 shows 2 proposals. Verify green.

## C07 — SDK additive helpers + example (no wire break)

Goal: builders can automate guarded stock buys; bounty "tools" box checked.
- Add `getTokenUniverse()`, `getStockResearch(symbol)` reads + `sdk/examples/stocks-dca.ts` (ask -> check.allowed -> sign loop).
- `sdk/README.md` section + version minor bump. No change to existing methods/types.
- Test in `sdk/test/` (mock fetch): universe shape, money-string discipline.

Files: `sdk/src/*`, `sdk/examples/stocks-dca.ts`, `sdk/README.md`, `sdk/package.json` (version)
Exit: example runs against local dev (`PRAXIS_LOCAL_INTENT=1`) and prints ALLOWED/BLOCKED honestly. Root + sdk verify green.

## C08 — Demo hardening: tokencheck + stocksgate gates

Goal: CI-grade honesty gates for the video.
- Extend `scripts/tokencheck.ts` pattern: `scripts/stocksgate.ts` asserts 8 mints resolve, unknown mint -> `MintNotAllowed`, research degrades, swaps stay blocked (unless C01 proved route — then route asserted behind allow-list).
- `scripts/praxis-demo.ts` gains `--stocks` mode: research -> buy $40 -> over-cap $500 block -> pause -> resume.
- Docs: demo runbook appended to PRESTOCKS-SPIKE.md.

Files: `scripts/stocksgate.ts`, `scripts/praxis-demo.ts`, docs append
Exit: `bun run praxis:stocksgate && bun run praxis:swapcheck && bun run praxis:tokencheck` all green.

## C09 — Staging deploy + video evidence

Goal: live URL judges can click.
- Vercel preview with `PRAXIS_STOCKS_ENABLED=1`, devnet program, `PRAXIS_STOCK_MINTS` mirror block for the 8 stocks, Postgres state.
- Record 90-sec video per STOCKLANA.md demo script; capture Explorer links + over-cap rejection (off-chain + on-chain log).
- `docs/DEPLOY.md` addendum: stock env values (no secrets).

Files: docs addendum only + deployed URL in submission draft.
Exit: cold browser can research + propose + block. No mock mode in prod build.

## C10 — Submission packaging

Goal: submit before deadline with room to spare.
- README: 3-line Stocks section + screenshots/GIF + links (demo, video, PreStocks attribution).
- Submission copy: problem, solution, why Solana, Aegis envelope, exclusivity statement (PreStocks only).
- Invite teammates via submit form; keep branch open for edits till close.

Files: `README.md`, submission draft doc.
Exit: submitted with GitHub + live demo + video links. Tag `stocklana-submit`.

## C11 — Token-2022 support (done; supersedes the "no program edits" rule)

Rule 3 below forbade touching `aegis/programs/**` in C01–C10. That rule was
written on the assumption that the PreStocks mints were classic SPL. They are
**Token-2022**, verified on-chain 2026-09-20 — so `agent_transfer_spl` could
never move them, and the entire stock surface was unexecutable. Honouring the
rule would have meant shipping a submission whose headline feature cannot
produce a transaction.

Done instead:
- `agent_transfer_spl` accepts SPL Token or Token-2022, takes the mint as an
  account, and CPIs `TransferChecked`. LiteSVM **T8** covers it; T1–T7 still green.
- Client threads the token program through every ATA derivation (it is a seed
  of the address, so a wrong default silently targets the wrong account).
- Mirror mints (`praxis:setup-devnet-stocks`, `PRAXIS_STOCK_MINTS`) because the
  real mints are mainnet-only.
- `praxis:stocksbuycheck` asserts the whole claim against a live cluster.

## C12+ — Post-hackathon only (do not start before judging)

- Multi-mint envelope program upgrade (Anchor resize + LiteSVM gate + migration).
- Real `agent_swap` with on-chain program/mint allow-lists + value caps (the README bar).
- Transfer-hook support (decide which hook programs are trustworthy) and
  fee-aware proposal display.
- Managed vault-funding UX, durable rejected-tx indexer (ARCHITECTURE.md gaps).

---

## Agent rules for this roadmap

1. One commit per `Cxx`. Small diffs, passing verify each time.
2. Feature-flag everything stock-specific until C09 (`PRAXIS_STOCKS_ENABLED`).
3. ~~No `aegis/programs/**` edits in C01–C10.~~ **Superseded by C11** — the rule
   assumed classic-SPL mints; see above. Still binding: no Gemini prompt widens
   advice, and no fake swap signing.
4. Every research/policy number shown in UI must come from server-computed values, never LLM prose.
5. If PreStocks API drifts, update PRESTOCKS.md §1 + SPIKE doc in the same commit as the code fix.
