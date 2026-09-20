# Stocklana submission copy — Praxis for Stocks

Bounty: PreStocks. Exclusivity (binding): every pre-IPO mint in the submission
is a PreStocks mint. No non-PreStocks pre-IPO tokens appear anywhere in the
submission branch (universe, baskets, docs, demo).

## Problem

First-time stock buyers find wallets scary and won't hand an AI their brokerage
password — and they shouldn't. Agentic crypto today asks you to trust a backend
with a hot key and hope its prompt-handling is correct. A jailbroken prompt, a
misparsed amount, or a breached server can drain you.

## Solution

Text to invest in pre-IPO stocks on Solana, with limits even a hacked AI can't
break. You type `buy $40 openai`; the agent interprets intent, but the Aegis
program enforces the envelope on-chain: per-transaction caps, rolling daily
caps, recipient allow-lists, expiry, pause — checked inside the instruction
before any value moves. Worst case, a misbehaving agent is bounded by the
policy, not by the quality of a prompt.

- **Guarded buys**: every buy is a proposal with a simulated Aegis verdict. You sign; Aegis re-checks on-chain.
- **Recurring buys**: `buy $50 spacex every monday` creates a schedule. Each fire emits a proposal through the same checks. Nothing auto-signs, ever.
- **Baskets**: `buy ai basket $60` splits USD equally via PreStocks prices into per-stock proposals. Any blocked or unpriceable constituent clarifies the whole basket — never a partial fill.
- **Honest blocks**: over-cap buys are rejected off-chain AND on-chain, styled first-class. The chain saying "no" is the demo.

## Why Solana

24/7 SPL settlement for pre-IPO stocks, a program-owned vault PDA (the agent
key can sign only what the policy allows), and composable stock mints. The
on-chain ActionLog is the audit trail judges can click.

## Aegis envelope (what judges can verify)

- `agent_transfer` / `agent_transfer_spl`: signer, pause, expiry, per-tx cap, daily cap, allow-list, configured mint.
- Token-2022 is supported (the PreStocks mints are Token-2022): the CPI is
  `TransferChecked`, so the token program re-verifies mint and decimals.
- LiteSVM gate `bun run aegis:test` (T1–T8, T8 = the Token-2022 envelope) +
  offline gate `bun run praxis:stocksgate` + live `bun run praxis:stockscheck`.
- **`bun run praxis:stocksbuycheck`** — the whole claim in one command against
  a live cluster: the buy lands, the over-cap buy is refused by the program:

Run on **devnet** 2026-09-20:

```
✓ mint is Token-2022      TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
✓ buy CONFIRMED on-chain  5JLjHAjCy3oH1ejpdAWWoe7jxLaZjGhyLeirTDxzH6gr…
✓ recipient credited exactly 40, vault debited exactly 40
✓ over-cap buy REJECTED on-chain — reason code 3 (OverPerTx)
✓ vault untouched by the blocked buy
```

Explorer (the buy):
<https://explorer.solana.com/tx/5JLjHAjCy3oH1ejpdAWWoe7jxLaZjGhyLeirTDxzH6grwDRT9WsiCNFZWhte7tdRNYdHmbUUaMuC7bDyXA8rtgg7?cluster=devnet>

Program: `3z9GuipayYpAcPnjiwFkfe6gZvfSfuPZgX8djYu67Yhd` (devnet, Token-2022 build).

## Honest scope (read this before judging)

- **Demo cluster uses mirror mints.** The real PreStocks mints are mainnet-only,
  so the devnet demo buys Token-2022 stand-ins created by
  `bun run praxis:setup-devnet-stocks` — same symbol, same 9 decimals, same
  token program, so the code path is identical. Prices and research come from
  the live PreStocks API. The app labels a mirrored universe in the UI.
  Devnet OPENAI mirror: `JDQzde3RyKMaJTVNxwR2ocFLrqvcjR2Rq5BZiy6QX3tx`.
- **The issuer outranks the policy.** PreStocks holds `PermanentDelegate`,
  freeze and pause authority on the real mints. Aegis bounds what the *agent*
  can do with your vault; it cannot bound the issuer of a token you chose to
  hold. Our claim is about agent risk, and we would rather say where it stops.
- **Swaps are still blocked.** Parsed and previewed, never signed — there is no
  Jupiter CPI. A real swap path must enforce mint/program allow-lists and value
  caps inside the instruction.

## Links (fill at submit time)

- Live demo: the C09 staging preview (Policy → SPL shows the stock switcher).
- Video: 90-second shot list in docs/DEPLOY.md (C09).
- Code: this branch. Docs: docs/STOCKLANA.md, docs/PRESTOCKS.md, docs/PRESTOCKS-SPIKE.md.
