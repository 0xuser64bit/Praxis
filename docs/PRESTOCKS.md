# PreStocks integration spec — Praxis for Stocks

Date: 2026-09-18
Status: approved (design)
Parent: [STOCKLANA.md](./STOCKLANA.md) · Roadmap: [STOCKLANA-ROADMAP.md](./STOCKLANA-ROADMAP.md)
Bounty: Best Use of PreStocks. API: `https://prestocks.com/api/prestocks`.
Exclusivity (binding): **no non-PreStocks pre-IPO token** may be integrated in the submission branch.

## 1. PreStocks API contract (verified 2026-09-18)

`GET https://prestocks.com/api/prestocks` returns a JSON array; each entry:

```json
{
  "name": "OpenAI PreStocks",
  "symbol": "OPENAI",
  "description": "... backed 1:1 by SPV exposure ...",
  "image": "https://www.prestocks.com/logos/openai.png",
  "external_url": "https://www.prestocks.com/openai",
  "contract_address": "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
  "markPrice": 976.27,
  "markValuation": 1209532255249,
  "tokenPrice": 1088.50,
  "impliedValuation": 1348581175120,
  "supply": 2826.496229099
}
```

Universe (8, all pre-IPO):

| Symbol | Mint (`contract_address`) | Notes |
|---|---|---|
| ANDURIL | `PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB` | |
| ANTHROPIC | `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw` | |
| FIGUREAI | `PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd` | |
| KALSHI | `PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua` | Tessera bounty mentions Kalshi T-Tokens — **do not** mix; PreStocks KALSHI only |
| NEURALINK | `PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S` | |
| OPENAI | `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF` | Hero demo asset |
| POLYMARKET | `Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP` | |
| SPACEX | `PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh` | |

Resolved on-chain 2026-09-20 (read from the mint accounts, not guessed):

- **`decimals` = 9** for all eight mints — not the 6 the universe originally
  shipped, which mis-scaled every amount by 1000x.
- **Token program = Token-2022** (`TokenzQd…`), not classic SPL. This is why
  `agent_transfer_spl` gained Token-2022 support; without it no stock buy
  could execute at all.
- **Extensions present:** `PermanentDelegate`, `DefaultAccountState`,
  `TransferFeeConfig`, `TransferHook`, `PausableConfig`,
  `ConfidentialTransfer*`, `MetadataPointer`, `TokenMetadata`.
  Values that matter: default account state = **Initialized** (new ATAs are
  not frozen), transfer fee = **0 bps**, transfer hook program = **unset**.
  So today they move like plain tokens — which is what makes the integration
  tractable. `PermanentDelegate` / freeze / pause all sit with the issuer
  (`WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc`); disclosed in SUBMISSION.md.
- **Mints are mainnet-only** — absent from devnet, hence the mirror-mint
  workflow (`PRAXIS_STOCK_MINTS`, `bun run praxis:setup-devnet-stocks`).

Still open:
- Mainnet liquidity / Jupiter routability per mint (DexScreener + Jupiter quote probe).
- `tokenPrice` vs `markPrice` semantics for display (show both, label honestly until confirmed).

## 2. Token registry design

- Source of truth at runtime: `PRAXIS_TOKENS` env JSON (existing seam in `server/env.ts:parseTokens`),
  extended with the 8 PreStocks entries once decimals are confirmed.
- Static fallback: `server/env.ts:DEFAULT_TOKENS` keeps SOL/USDC/JUP/BONK; PreStocks entries live
  behind `PRAXIS_STOCKS_ENABLED=1` so `main` behavior is unchanged when the flag is off.
- Canonical display symbols: `pOPENAI` etc. are UI aliases only; on-chain mint is the PreStocks
  `contract_address`. Intent normalization uppercases and strips a leading `p` for stock lookup
  (exact rule in C04).
- `verified: true` only for the 8 mints above. Everything else is unverified and blocked by the
  existing mint allow-list path.
- Token envelope: one `tokenMint` per Aegis policy (program constraint). Hackathon operating
  model = one policy per stock (see STOCKLANA.md). `configureToken` + `prepareTokenAccounts`
  already exist in SDK/API; no new owner instruction.

New env (all optional, documented in `.env.example`):

```
PRAXIS_STOCKS_ENABLED=0
PRAXIS_PRESTOCKS_API_URL=https://prestocks.com/api/prestocks
PRAXIS_PRESTOCKS_TIMEOUT_MS=5000
PRAXIS_STOCK_UNIVERSE=OPENAI,SPACEX,ANTHROPIC
```

`PRAXIS_STOCK_UNIVERSE` is a display/order filter, never an enforcement bypass.

## 3. Research adapter design

Extend `server/agent/research.ts`, do not replace it.

```
researchToken(symbol) ->
  1. resolveToken (existing, plus stock alias map)
  2. fetch PreStocks entry by symbol (new, timeout 5s, cache 60s in-memory)
  3. fetch on-chain supply/decimals via research RPC (existing)
  4. fetch DexScreener pairs (existing, may be empty for pre-IPO)
  5. merge metrics: Price = PreStocks tokenPrice (+ markPrice second row),
     Supply = on-chain when available else PreStocks supply (labeled),
     24h change/volume = DexScreener when present else "unavailable"
  6. summary = neutral, data-only + PreStocks attribution + SPV-backing note from description
```

Rules:
- PreStocks failure degrades to existing behavior (never fails the card).
- Never emit buy/sell/hold advice (existing intent rule holds for stocks).
- Every stock research block carries `external_url` + risk line: pre-IPO, SPV exposure, may be illiquid.
- Unit-testable pure merge function `mergeStockResearch(prestocks, chain, indexer)`.

## 4. Intent mapping (no new value-moving instruction)

Stock phrasing maps onto the existing `ParsedAction` union, which gained one
field for it: `transfer.toSelf`, set when a *buy* names no recipient (see the
first row). It is an explicit flag rather than an absent `recipient`, so a
model that merely drops the field on a `send` still lands in the clarify path.

| User says | Parsed as | Notes |
|---|---|---|
| `buy $40 openai` / `buy 0.1 openai for maya` | `transfer(asset=pOPENAI…)` | Amount in token base units after decimal lookup — the `$` is **not** a unit, `$40 openai` is 40 OPENAI. The sigil is recorded (`usdSigil`) and the reply names the reading, because the two can be orders of magnitude apart. A named recipient resolves through the address book; no recipient settles into the owner's own wallet (`toSelf`), the same default a recurring buy takes |
| `sell $20 openai` | `transfer` to vault/treasury (direction labeled) or `swap_stub` if route exists | C01 decides; default transfer-only |
| `buy $50 openai every monday` | `transfer` + DCA schedule metadata (off-chain) | Mechanical cron, same policy checks per fire |
| `buy mag7 basket $100` | ordered `transfer[]` (one per constituent) | Sequential proposals, per-stock policy each |
| `swap 10 usdc for openai` | `swap_stub` (blocked unless C01 proves route) | Honest blocked copy preserved |

Deterministic fallback `parseIntentLocallyForDemo` learns: `buy/sell`, `p`-prefixed symbols,
`dca/every monday`, `basket <name>`. Gemini system prompt gains the same synonyms + stock alias list.
`policy_question` / `policy_change` / `save_contact` work unchanged for stocks.

## 5. Policy + enforcement

**Superseded:** the branch originally forbade Anchor changes, on the assumption
that the stock mints were classic SPL. They are Token-2022, so
`agent_transfer_spl` was extended (accept both token programs, `>= 165`-byte
accounts with an `AccountType::Account` guard, `TransferChecked` with the mint
as an account). LiteSVM T8 covers it. Without that change the entire stock
surface is unexecutable, which is not a constraint worth honouring.

All stock buys flow through:
`checkTokenTransferPolicy` (paused -> expiry -> token configured -> mint == token_mint ->
recipient allow-list -> per-tx -> daily) and `agent_transfer_spl` on-chain.

Per-stock caps recommended defaults (tunable via Policy UI):
`tokenMaxPerTx` = $50 equiv, `tokenDailyLimit` = $200 equiv, expiry 30d, pause available.
Portfolio cap is display-only; label it as such wherever shown.

## 6. Post-hackathon follow-up (not in branch)

Multi-mint envelope: `tokenMints: Vec<Pubkey>` + per-mint caps/counters, `ACTION_LOG` mint field
already exists. Requires Anchor account resize (`MAX_ALLOWED_MINTS`), LiteSVM gate
(`bun run aegis:test`), SDK major/minor bump, migration for existing policies. Spec only.

## 7. SDK impact (additive only)

`@usepraxis/sdk` wire types unchanged. Additive:
- `getTokenUniverse()` (or reuse `getAddressBook`-style read for stocks)
- Example: `sdk/examples/stocks-dca.ts` — `ask("buy $40 openai")` loop with `check.allowed` gate
- Docs note in `sdk/README.md` + root README link
- Version: minor bump; no breaking change to `/api/praxis/*`

## 8. Verification

- `bun run lint`, `bun run test`, `bun run build`
- `bun run aegis:test` (program untouched — must stay green)
- `bun run praxis:tokencheck` + new `praxis:stockscheck` (C01/C03): asserts PreStocks mints resolve,
  research degrades honestly, unauthorized mint blocked with `MintNotAllowed`
- Manual: devnet OPENAI buy + over-cap block, Explorer links in video
