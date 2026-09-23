# Praxis

Praxis is a conversational Solana agent. You type intent in plain language —
*"send 0.5 SOL to maya"* — and the agent turns it into a typed, simulated
on-chain action. What makes it safe is **Aegis**: an Anchor program that enforces
a scoped spending policy on-chain.

The core claim is one sentence: **the agent may interpret intent, but the program
enforces the envelope.** An LLM, a parser, or a compromised backend can propose
anything; none of them can move value past the caps, allow-lists, and expiry that
Aegis checks inside the instruction itself.

## Why

Agentic crypto usually asks you to trust a backend with a hot key and hope its
prompt-handling is correct. That puts the security boundary in the wrong place —
in software that can be jailbroken, misparsed, or breached. Praxis moves the
boundary onto the chain. The agent holds only a *scoped* key, and every transfer
it signs is validated by Aegis against an owner-defined policy before any SOL or
tokens leave the vault. Worst case, a misbehaving agent is bounded by the
policy, not by the quality of a prompt.

## How it works

1. You enter text in the conversation surface.
2. The agent parses it into a typed action (Gemini, then Groq, then a local
   deterministic parser for $0 demos — free-tier quotas are per-provider, so
   the second one is what keeps parsing working after the first runs out).
   A signed-in browser can call Gemini or Groq itself with a key that stays
   in local storage. Praxis receives that reading, not the key.
3. Recipient names resolve through an off-chain address book.
4. The action is simulated and checked against the policy, producing a proposal
   card with the fee, the simulation result, and the Aegis verdict.
5. On confirm, the backend signs an Aegis instruction with the **scoped agent
   key** and submits it. A proposal stays signable for a week: its amount is
   fixed and Aegis enforces the envelope live, but the readings on the card
   drift, and nobody should sign a preview whose intent they no longer
   remember.
6. Aegis enforces the policy *on-chain* — signer, pause, expiry, per-transaction
   cap, rolling daily cap, recipient allow-list, and (for SPL) the configured
   mint and token envelope — before value moves.

Aegis exposes two value instructions: `agent_transfer` (native SOL) and
`agent_transfer_spl` (one configured SPL token). Owner actions — fund, withdraw,
update policy, allow-lists, revoke, rotate — are intentionally unconstrained by
agent caps and are **wallet-signed** by the owner; the backend never holds the
owner key.

**Trusted:** Solana consensus, the Aegis program, and owner wallet signatures.
**Not trusted for enforcement:** prompt text, LLM output, the mock parser, the
off-chain policy mirror, and the UI. The off-chain mirrors exist only for
explainability and previews — never as the source of truth for value movement.

Full design and trust boundaries: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## SDK

[`@usepraxis/sdk`](sdk/) is a typed, Node-first client for a hosted Praxis
backend. It signs the wallet-ownership challenge, holds the session, and drives
the agent. It never holds your model keys or the agent private key — those stay
server-side behind Aegis.

```bash
npm install @usepraxis/sdk
```

```ts
import { PraxisClient, keypairSigner } from "@usepraxis/sdk";

const praxis = new PraxisClient({
  baseUrl: "https://your-praxis.app",
  signer: keypairSigner(process.env.PRAXIS_SECRET_KEY!),
});

await praxis.connect();
const { proposals } = await praxis.ask("send 0.5 SOL to maya");

for (const p of proposals) {
  if (p.check.allowed) await praxis.signProposal(p.id); // Aegis enforces caps on-chain
}
```

See [sdk/README.md](sdk/README.md) for the full surface.

## Stocks (PreStocks)

Text to invest in pre-IPO stocks on Solana, with limits even a hacked AI
can't break: `buy $40 openai`, `buy $50 spacex every monday`,
`buy ai basket $60`. Same Aegis envelope — per-stock caps, allow-lists,
expiry, pause — enforced on-chain by the program, not by the backend.

A `$` means dollars: `buy $40 openai` is $40 of OPENAI, converted to a
quantity at the live PreStocks price (the same math that splits
`buy ai basket $60`), and the reply names the price it used. With no price
the agent asks rather than guessing; without a `$`, `buy 0.05 openai` is a
quantity. A recurring buy fixes its quantity at today's price, and every
fire is re-checked against the caps. A buy with no recipient settles into
your own wallet. A stock's envelope defaults to $100 per buy and $500 a day
at its PreStocks price, and Aegis enforces those caps on-chain as token
quantities.

The PreStocks mints are **Token-2022**, so Aegis drives both SPL Token and
Token-2022 (`TransferChecked`). The full path is asserted, not screenshotted:

```bash
PRAXIS_STOCKS_ENABLED=1 bun run dev   # 8 PreStocks symbols, switcher in Policy → SPL
bun run praxis:stocksgate             # offline honesty gate (CI-grade, no network)
bun run aegis:test                    # LiteSVM T1–T9, incl. the Token-2022 envelope
bun run praxis:stocksbuycheck         # live cluster: buy lands, over-cap refused on-chain
```

`praxis:stocksbuycheck` output on a local validator:

```
✓ mint is Token-2022      TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
✓ buy CONFIRMED on-chain  23F5x1WuPSYoDEbvrccPG7fZRW2gQJbbpb8jC8uPRP2v…
✓ recipient credited exactly 40, vault debited exactly 40
✓ over-cap buy REJECTED on-chain — reason code 3 (OverPerTx)
✓ vault untouched by the blocked buy
```

**Demo cluster uses mirror mints.** The real PreStocks mints exist on mainnet
only, so a devnet demo cannot move them. `bun run praxis:setup-devnet-stocks`
creates a Token-2022 stand-in per symbol on the demo cluster and prints the
`PRAXIS_STOCK_MINTS` block. A mirror reproduces what the buy path exercises —
symbol, 9 decimals, Token-2022 — and not the issuer's permanent-delegate,
freeze or pause authorities. Prices and research still come from the live
[PreStocks API](https://prestocks.com/). The app labels a mirrored universe
wherever it is shown.

**What the issuer can still do.** PreStocks holds `PermanentDelegate`, freeze
and pause authority on the real mints. Aegis bounds what the *agent* can do
with your vault; it cannot bound the issuer of a token you chose to hold. We
name that rather than let "limits even a hacked AI can't break" imply more
than it does.

DCA schedules emit proposals (never auto-sign), and each fired card stays
signable for a week, so a weekly buy does not expire before you get to it;
baskets are all-or-nothing —
any blocked or unpriceable constituent clarifies the whole basket. Firing is a
scheduled job (`vercel.json` → `/api/cron/stocks`, authenticated with
`CRON_SECRET`) that fans out across every wallet with a due schedule; set that
secret or recurring buys never fire. Pre-IPO mints here are PreStocks-only by
bounty exclusivity. Submission copy: [docs/SUBMISSION.md](docs/SUBMISSION.md).

## Future scope

Praxis is a strong devnet MVP. The production seams — managed Postgres state,
wallet-signed owner actions, remote agent-key custody, cross-instance rate
limiting, structured logging — are all in place and switch on by configuration.

Deliberately **not** built yet:

- **Real swaps.** Swap intents are parsed and previewed, but always blocked.
  There is no Jupiter CPI and no `agent_swap` instruction. A real swap path must
  enforce mint/program allow-lists and value caps *inside the program*, not in a
  quote or backend — that is the bar for adding it.
- **Token-2022 transfer hooks.** A mint with an active transfer hook needs
  extra accounts `agent_transfer_spl` does not pass, so the CPI fails and the
  transaction reverts — safe, but unsupported. Supporting hooks means deciding
  which hook programs are trustworthy, which belongs in the allow-list.
- **Transfer-fee accounting.** A fee mint debits the vault by the capped
  amount and credits the recipient less. Correct for a spending policy, but
  the proposal card should show the net the recipient receives.
- Auto-signing DCA fires (the scheduler emits proposals; each fire still needs
  a signature — auto-sign stays out by design).
- Managed vault-funding UX (token-vault funding is script-driven for now).
- A durable indexer for rejected actions (the on-chain log stores allowed
  actions; rejections currently live as failed-tx logs).

The guiding rule: new features must strengthen the safety thesis, not create
escape hatches around it. No fake swap signing, no autonomous trading advice, no
delegated authority over your main wallet.

## Run it

```bash
# Mock mode — no chain, keys, or LLM key. Local smoke test of the UI/policy flow.
NEXT_PUBLIC_PRAXIS_PROVIDER=mock bun run dev
# open http://localhost:3000/app
```

For the real Aegis send flow on devnet, and for deploying behind a remote
signer, see **[docs/DEPLOY.md](docs/DEPLOY.md)**.

## Validate

```bash
bun run lint
bun run test       # auth/session, validation, state, Aegis codec, API routes — no network
bun run build
bun run aegis:test # rebuild the Anchor program + run the LiteSVM enforcement gate (T1–T9)
bun run aegis:idl  # rebuild and re-sync the generated IDL into @praxis/shared
```

## Layout

| Path | What |
|---|---|
| `app/`, `components/` | Next.js product app and `/app` conversation surface |
| `server/` | provider seam, agent intent parsing, Aegis client, state repositories |
| `aegis/` | the Aegis Anchor program and its LiteSVM enforcement tests |
| `signer/` | standalone agent-key signer for production custody |
| `sdk/` | `@usepraxis/sdk` typed client |
| `scripts/` | demo, money-shot, and enforcement-check scripts |
