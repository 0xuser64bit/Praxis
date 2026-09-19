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
- LiteSVM gate `bun run aegis:test` (T1–T7) + offline gate `bun run praxis:stocksgate` + live `bun run praxis:stockscheck`.
- Funded-cluster demo: `bun run praxis:demo -- --stocks`.

## Links (fill at submit time)

- Live demo: the C09 staging preview (Policy → SPL shows the stock switcher).
- Video: 90-second shot list in docs/DEPLOY.md (C09).
- Code: this branch. Docs: docs/STOCKLANA.md, docs/PRESTOCKS.md, docs/PRESTOCKS-SPIKE.md.
