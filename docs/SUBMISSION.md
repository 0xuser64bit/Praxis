# Stocklana submission copy — Praxis for Stocks

Tracks: main track + **Best Use of PreStocks**. Exclusivity (binding): every
pre-IPO mint in the submission is a PreStocks mint. No non-PreStocks pre-IPO
token appears anywhere in the code, universe, baskets, docs or demo.

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

- **Guarded buys, in dollars**: `buy $40 openai` is $40 of OPENAI at the live PreStocks price; the reply names the price, the card shows the quantity you sign, and Aegis re-checks it on-chain. No price, no guess — the agent asks.
- **Recurring buys**: `buy $50 spacex every monday` creates a schedule. Each fire emits a proposal through the same checks. Nothing auto-signs, ever.
- **Baskets**: `buy ai basket $60` splits dollars across PreStocks constituents at their live prices. Any blocked or unpriceable constituent clarifies the whole basket — never a partial fill.
- **Limits in plain words**: a stock envelope defaults to $100 per buy and $500 a day; `set my daily limit to $100` proposes exactly that, for your signature.
- **Honest blocks**: `buy $500 openai` is rejected off-chain AND on-chain, styled first-class. The chain saying "no" is the demo.
- **Research, not advice**: `research openai` shows the PreStocks mark and token price side by side, supply, and what the issuer can still do to the token. No buy/sell/hold calls.

## Why it is a PreStocks integration, not a PreStocks mention

It sits in three of the bounty's listed categories at once — an **AI agent**,
an **automated** recurring-buy engine, and a **research** surface — and
PreStocks is load-bearing in each:

- The live PreStocks API prices every dollar buy, splits every basket, sets
  every stock envelope's default caps, and fills the research card.
- The 8-symbol universe, baskets and aliases (`popenai`, `pSpaceX`) are the
  PreStocks universe and nothing else.
- The PreStocks mints are Token-2022 — so the on-chain program was extended to
  drive Token-2022 with `TransferChecked`. Without that, no PreStocks token
  could move through an agent guardrail at all.
- We read the real mints before building on them (9 decimals, Token-2022,
  issuer authorities) and disclose what that means below.

## Why Solana

24/7 SPL settlement for pre-IPO stocks, a program-owned vault PDA (the agent
key can sign only what the policy allows), and composable stock mints. The
on-chain ActionLog is the audit trail judges can click.

## Try it yourself (devnet, ~3 minutes)

1. Open <https://app.usepraxis.fun>, connect Phantom on **devnet** (devnet SOL
   from <https://faucet.solana.com>), and initialize your policy.
2. Policy → Token transfers → switch the envelope to **OPENAI** (one signature;
   caps default to $100 per buy / $500 a day).
3. Click **$1,000 demo OPENAI** — the devnet faucet mints mirror stock into
   your own vault.
4. Conversation: `buy $40 openai` → sign → Explorer link.
5. `buy $500 openai` → blocked, and the program is what says no.

## Aegis envelope (what judges can verify)

- `agent_transfer` / `agent_transfer_spl`: signer, pause, expiry, per-tx cap, daily cap, allow-list, configured mint.
- Token-2022 is supported (the PreStocks mints are Token-2022): the CPI is
  `TransferChecked`, so the token program re-verifies mint and decimals.
- LiteSVM gate `bun run aegis:test` (T1–T10: T8 = the Token-2022 envelope, T10 = a cap change never resets today's spend) +
  offline gate `bun run praxis:stocksgate` + live `bun run praxis:stockscheck`.
- **`bun run praxis:stocksbuycheck`** — the whole claim in one command against
  a live cluster: the buy lands, the over-cap buy is refused by the program:

Run on **devnet** 2026-09-20 (raw token quantities, against its own OPENAI
mirror `JDQzde3RyKMaJTVNxwR2ocFLrqvcjR2Rq5BZiy6QX3tx`):

```
✓ mint is Token-2022      TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
✓ buy CONFIRMED on-chain  5JLjHAjCy3oH1ejpdAWWoe7jxLaZjGhyLeirTDxzH6gr…
✓ recipient credited exactly 40, vault debited exactly 40
✓ over-cap buy REJECTED on-chain — reason code 3 (OverPerTx)
✓ vault untouched by the blocked buy
```

Explorer (the buy):
<https://explorer.solana.com/tx/5JLjHAjCy3oH1ejpdAWWoe7jxLaZjGhyLeirTDxzH6grwDRT9WsiCNFZWhte7tdRNYdHmbUUaMuC7bDyXA8rtgg7?cluster=devnet>

The program logs on that transaction are the whole thesis in four lines — the
agent's instruction enters Aegis, and Aegis is what calls the token program:

```
Program 3z9GuipayYpAcPnjiwFkfe6gZvfSfuPZgX8djYu67Yhd invoke [1]
Program log: Instruction: AgentTransferSpl
Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb invoke [2]
Program log: Instruction: TransferChecked
```

The agent key never touches the token program directly. It can only ask
Aegis, and Aegis checks the envelope first — which is why the 500-unit
attempt above never reaches `invoke [2]` at all.

Program: `3z9GuipayYpAcPnjiwFkfe6gZvfSfuPZgX8djYu67Yhd` (devnet, Token-2022 build).

## Honest scope (read this before judging)

- **A buy moves stock out of your guarded vault; it does not purchase it.**
  There is no USDC → stock swap: a real swap path must enforce mint/program
  allow-lists and value caps inside the instruction, and we will not sign a
  swap the program cannot enforce. Swaps are parsed and previewed, always
  blocked. What Praxis guards today is the agent's access to stock you hold.
- **Demo cluster uses mirror mints.** The real PreStocks mints are
  mainnet-only, so the devnet demo moves Token-2022 stand-ins — same symbol, 9
  decimals, same token program, so the code path is identical. Prices and
  research come from the live PreStocks API. The app labels a mirrored
  universe, and the demo faucet mints mirrors only, never on mainnet.
- **Dollar amounts are priced once.** A dollar buy or cap is converted at the
  PreStocks price when it is proposed; Aegis enforces token quantities. A
  recurring buy fixes its quantity at creation.
- **The issuer outranks the policy.** PreStocks holds `PermanentDelegate`,
  freeze and pause authority on the real mints. Aegis bounds what the *agent*
  can do with your vault; it cannot bound the issuer of a token you chose to
  hold. Our claim is about agent risk, and we would rather say where it stops.

## Links

- Live demo: <https://app.usepraxis.fun> (landing: <https://usepraxis.fun>)
- Code: <https://github.com/0xuser64bit/Praxis>
- Video: 90-second shot list in [DEPLOY.md](./DEPLOY.md#demo-video-shot-list-90-seconds-human-task)
- Deeper docs: [ARCHITECTURE.md](./ARCHITECTURE.md), [PRESTOCKS.md](./PRESTOCKS.md), [PRESTOCKS-SPIKE.md](./PRESTOCKS-SPIKE.md)
