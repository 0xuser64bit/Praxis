# Stocklana strategy — Praxis for Stocks

Date: 2026-09-18
Status: approved (founding decision)
Hackathon: Stocklana — stocks on Solana, $100K. Submissions close Fri 25 Sep 4pm ET. Judging through 2 Oct.
Bounty primary: PreStocks ($5k / $3k / $2k). Exclusivity: no non-PreStocks pre-IPO tokens in the submission.

## Thesis

Tokenized stocks already trade on Solana. Brokerage apps win on trust, not charts.
Praxis wins by making AI money for stocks **safe by construction**: the agent interprets,
Aegis enforces the envelope on-chain. A jailbroken prompt, bad parse, or compromised
backend can propose anything — none of it moves value past caps, allow-lists, and expiry
checked inside the instruction.

Tagline: **Text to invest in stocks on Solana, with limits even a hacked AI can't break.**

## Wedge (pick one, make it excellent)

**Investing + Consumer.** Guarded conversational buying, recurring buys, and index baskets
of pre-IPO stocks. Mobile-first chat, not a terminal.

Demo user: first-time stock buyer who finds wallets scary and won't hand an AI their
Schwab password. They will type `buy $40 of OpenAI` if — and only if — they believe
the AI cannot drain them.

Out of scope for judging: full trading venue, perps, lending, price-feed infra.
We consume those; we don't build them.

## Judging mapping

| Judge question | Praxis answer | Proof in demo |
|---|---|---|
| Real user + problem | New investor fears AI + 24/7 markets moving while asleep | Caps + pause + expiry story, plain language |
| Working E2E | Chat -> research -> proposal + Aegis verdict -> confirm -> landed tx -> activity | Devnet video + live URL + Explorer links |
| Why Solana | 24/7 SPL settlement + program-owned vault + composable stock mints | PreStocks SPLs, Aegis PDA vault, ActionLog |
| Quality | One flow polished: research, buy, DCA, basket, block | Negative test: over-cap buy blocked off-chain AND on-chain |

## Scope for 7 days

In:
- PreStocks token universe (8 mints, verified, feature-flagged)
- Research adapter: PreStocks API first, DexScreener/RPC fallback
- Intent: `buy / sell / DCA / basket` synonyms mapped onto existing `transfer` + `swap_stub` preview; no new value-moving instruction
- One-policy-per-stock operating model (works around single-mint envelope, no program change)
- Mechanical DCA (cron emitting same proposal flow, same checks)
- Basket = ordered transfer proposals in one thread
- SDK additive helpers (thin wrappers over `ask()`), docs + example script
- Demo: research, buy, policy change, pause, over-cap block

Not in (explicit non-goals):
- New `agent_swap` / Jupiter CPI on-chain (requires program-level allow-lists; see README future scope)
- Multi-mint envelope program rewrite (spec'd as follow-up, not in hackathon branch unless DCA/baskets force it)
- Tessera / any non-PreStocks pre-IPO token (bounty ineligibility)
- Clawpump token launch, Meteora DBC curves, lending/yield, perps
- Autonomous trading advice (research stays neutral data only)

## Operating model: one policy per stock

Aegis today enforces a **single** `tokenMint` per policy. A basket of 3 stocks cannot live
in one vault. For the hackathon we do NOT change the program. Instead:

- Each stock gets its own policy PDA (derived from owner + stock index/salt) OR the user
  rotates `configureToken` between buys (slower, worse UX — avoid).
- Preferred: one policy per stock, UI switches active policy by selected asset.
- Caps are per-stock (e.g. OPENAI $50/tx, $200/day) plus a client-side portfolio cap
  (sum display only, honest labeling: not on-chain enforced).
- Document this loudly. The follow-up (post-hackathon) is a multi-mint envelope program
  upgrade with per-mint caps — spec'd in PRESTOCKS.md §6, not built now.

## Demo script (90 seconds)

1. Connect devnet wallet -> Initialize policy for OPENAI ($200 daily, $50 per-tx, expiry 30d).
2. `research openai` -> PreStocks card: tokenPrice, markPrice, supply, 24h (or unavailable, honestly).
3. `buy $40 openai for maya` -> proposal: simulation + `ALLOWED` -> confirm -> `agent_transfer_spl` -> Explorer link.
4. `set my daily limit to $100` -> policy_change -> confirm.
5. `buy $500 openai` -> `BLOCKED — exceeds per-transaction cap` off-chain, and (money shot) submit attempt fails on-chain with `OverPerTx`. Chain says no.

## Risks

1. PreStocks decimals / liquidity unknown until RPC + Jupiter probe. Mitigation: Day-1 spike (ROADMAP C01), fallback to vault-prefunded transfers + quote preview.
2. Swap executability gap. Mitigation: transfer-only is shippable; swaps stay `swap_stub` blocked with honest copy. Never fake-sign a swap.
3. Single-mint wall confuses judges. Mitigation: name it in UI ("OPENAI vault · policy 3 of 3") and in video narration.
4. Scope creep into Tessera/DBC/Clawpump. Mitigation: bounty exclusivity + this doc's non-goals are binding for the branch.

## Links

- Integration spec: [PRESTOCKS.md](./PRESTOCKS.md)
- Commit plan: [STOCKLANA-ROADMAP.md](./STOCKLANA-ROADMAP.md)
- Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md) · Deploy: [DEPLOY.md](./DEPLOY.md)
