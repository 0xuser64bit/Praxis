# Praxis

Praxis is a conversational Solana agent. You type what you want, such as
*"send 0.5 SOL to maya"* or *"buy $40 openai"*, and the agent turns it into a
typed, simulated on-chain action for you to sign. **Aegis** keeps it safe.
Aegis is an Anchor program that enforces a scoped spending policy on-chain.

The core claim fits in one sentence: **the agent may interpret intent, but the
program enforces the envelope.** An LLM, a parser or a compromised backend can
propose anything. None of them can move value past the caps, allow-lists,
expiry and pause that Aegis checks inside the instruction.

- Live app (devnet): <https://app.usepraxis.fun>. The landing page is at <https://usepraxis.fun>.
- Aegis program (devnet): `3z9GuipayYpAcPnjiwFkfe6gZvfSfuPZgX8djYu67Yhd`
- SDK: [`@usepraxis/sdk`](sdk/) on npm

## How it works

1. You type a message in the conversation.
2. The agent parses it into a typed action. It tries Gemini, then Groq, then a
   local deterministic parser. Each provider has its own free-tier quota, so
   the second one keeps parsing alive after the first runs out. A signed-in
   browser can also call Gemini or Groq directly with a key kept in local
   storage. Praxis receives the parsed result, never the key.
3. Recipient names resolve through an off-chain address book.
4. The action is simulated and checked against the policy. The result is a
   proposal card showing the fee, the simulation and the Aegis verdict.
5. When you confirm, the backend signs an Aegis instruction with a **scoped
   agent key** and submits it. A proposal stays signable for a week. Its
   amount is fixed, and Aegis checks the envelope again when it lands.
6. Aegis runs its checks *on-chain* before any value moves: signer, pause,
   expiry, per-transaction cap, rolling daily cap and recipient allow-list.
   For SPL tokens it also checks the configured mint and token envelope.

Aegis has two value instructions: `agent_transfer` for native SOL and
`agent_transfer_spl` for one configured SPL Token or Token-2022 mint. Owner
actions are fund, withdraw, update policy, allow-lists, revoke and rotate.
Your own wallet signs them, and they are not limited by the agent caps. The
backend never holds the owner key.

**Trusted:** Solana consensus, the Aegis program and owner wallet signatures.
**Not trusted for enforcement:** prompt text, LLM output, the parser, the
off-chain policy mirror and the UI. The off-chain mirrors only explain and
preview. They never decide whether value moves.

Design, trust boundaries and concurrency are covered in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Stocks (PreStocks)

When `PRAXIS_STOCKS_ENABLED=1`, the agent handles the eight
[PreStocks](https://prestocks.com/) pre-IPO tokens (ANDURIL, ANTHROPIC,
FIGUREAI, KALSHI, NEURALINK, OPENAI, POLYMARKET, SPACEX). They get the same
Aegis envelope as any other token.

- `buy $40 openai` means $40 of OPENAI, converted to a quantity at the live
  PreStocks price. The reply names the price it used. If no price is
  available, the agent asks instead of guessing. `buy 0.05 openai` without a
  `$` is a quantity.
- `buy $50 spacex every monday` creates a schedule. Each fire produces a
  proposal that you still sign. Nothing auto-signs.
- `buy ai basket $60` splits the dollars across the basket's stocks at their
  live prices. If any one of them is blocked or has no price, the agent asks
  about the whole basket instead of filling part of it.
- `research openai` shows PreStocks data and what the issuer can still do to
  the token. It never gives buy, sell or hold advice.

What that does and does not mean:

- **A buy moves stock out of your guarded vault. It does not purchase it.**
  There is no USDC-to-stock swap. Swaps are parsed and previewed, but always
  blocked (see [Limitations](#limitations)). Praxis guards the agent's access
  to stock you already hold. A buy with no recipient settles into your own
  wallet.
- **Dollars are priced once.** A dollar amount or dollar cap is converted when
  it is proposed, and Aegis enforces token quantities. A recurring buy fixes
  its quantity when you create it. A stock envelope defaults to $100 per buy
  and $500 a day at the current price.
- **The PreStocks mints are Token-2022 and mainnet-only.** A devnet deployment
  runs on mirror mints: Token-2022 stand-ins with the same symbol and 9
  decimals. Prices and research still come from the live PreStocks API. The
  app labels a mirrored universe wherever it shows one.
- **The issuer outranks the policy.** PreStocks holds permanent-delegate,
  freeze and pause authority on the real mints. Aegis limits what the *agent*
  can do with your vault. It cannot limit the issuer of a token you chose to
  hold.

### Try it on devnet

1. Open <https://app.usepraxis.fun> and connect Phantom on **devnet**. You can
   get devnet SOL from <https://faucet.solana.com>. Then initialize your policy.
2. Go to Policy → Token transfers and switch the envelope to **OPENAI**. It
   takes one signature.
3. Click **$1,000 demo OPENAI** to mint mirror stock into your vault. This is
   limited to 3 grants per wallet per day.
4. `buy $40 openai` → sign → Explorer link.
5. `buy $500 openai` → blocked. The program is what refuses it.

### On-chain proof

`bun run praxis:stocksbuycheck` tests the whole claim against a live cluster.
Here is its output from devnet on the OPENAI mirror mint:

```
✓ mint is Token-2022      TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
✓ buy CONFIRMED on-chain  U53wAMhGme5Rh6HG7LtRqp5z6CczwqQj1h6szxvUf1C5…
✓ recipient credited exactly 40, vault debited exactly 40
✓ over-cap buy REJECTED on-chain — reason code 3 (OverPerTx)
✓ vault untouched by the blocked buy
```

The [buy transaction](https://explorer.solana.com/tx/U53wAMhGme5Rh6HG7LtRqp5z6CczwqQj1h6szxvUf1C5PsfeMt8PQHm4j8YVT3HREq1mVdLnhbYLgNQEnhZnKfS?cluster=devnet)
logs show that the agent key never calls the token program directly. Aegis
checks the envelope first, and only then calls the token program:

```
Program 3z9GuipayYpAcPnjiwFkfe6gZvfSfuPZgX8djYu67Yhd invoke [1]
Program log: Instruction: AgentTransferSpl
Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb invoke [2]
Program log: Instruction: TransferChecked
```

## SDK

[`@usepraxis/sdk`](sdk/) is a typed, Node-first client for a hosted Praxis
backend. It signs the wallet-ownership challenge, holds the session and drives
the agent. It never holds model keys or the agent private key.

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

See [sdk/README.md](sdk/README.md) for the full API.

## Development

You need [Bun](https://bun.sh) and Node.js 20.9 or later. To build or test
the Aegis program you also need Rust, the Solana CLI and Anchor, at the
versions pinned in `aegis/Anchor.toml`.

```bash
bun install
(cd sdk && bun install)

# Mock mode: no chain, keys or LLM key. The whole UI and policy flow runs in memory.
NEXT_PUBLIC_PRAXIS_PROVIDER=mock bun run dev   # http://localhost:3000/app
```

To run against a real cluster, with Aegis on devnet, local Postgres/Redis and
the env reference, see [docs/DEPLOY.md](docs/DEPLOY.md).

| Command | What it does |
|---|---|
| `bun run check` | lint + typecheck (app and SDK) + tests + production build. This is what CI runs. |
| `bun run test` | TypeScript suite. Offline, and it ignores `.env`. |
| `bun run praxis:stocksgate` | Offline stock gate. Also runs in CI. |
| `bun run aegis:test` | Rebuilds the program and runs the LiteSVM enforcement tests T1–T10 (`aegis/programs/aegis/tests/enforcement.rs`) |
| `bun run aegis:idl` | Rebuilds and copies the generated IDL into `shared/src/idl/`. Run it after any change to the program's interface. |
| `bun run signer` | Runs the standalone agent-key signer ([signer/README.md](signer/README.md)) |

Scripts that run against a live cluster are listed in
[docs/DEPLOY.md](docs/DEPLOY.md#verifying-a-cluster).

### Layout

| Path | What |
|---|---|
| `app/` | Next.js routes: landing page, `/app` conversation surface, `/api/praxis/*`, `/api/cron/stocks` |
| `components/`, `data/` | `praxis/` landing page (with its copy in `data/`), `app/` product UI, including the in-memory mock provider |
| `server/` | Provider, intent parsing, Aegis client, auth, state repositories, stocks |
| `shared/` | `@praxis/shared` types and the generated Aegis IDL |
| `aegis/` | The Aegis Anchor program and its LiteSVM tests |
| `signer/` | Standalone agent-key signer for production custody |
| `sdk/` | `@usepraxis/sdk`, published separately |
| `scripts/` | Demo, setup and live-cluster check scripts |
| `proxy.ts` | Host routing: serves `app.` from the same deployment |

## Limitations

These are deliberately not built. New features have to make the safety
guarantee stronger. They must not open a way around it.

- **Real swaps.** Swap intents are parsed and previewed, but always blocked.
  There is no Jupiter CPI and no `agent_swap` instruction. A real swap needs
  mint and program allow-lists and value caps enforced *inside the program*.
- **Several mints per envelope.** A policy holds one SPL envelope at a time.
  Switching stocks reconfigures it. Holding several mints at once needs a
  change to the account layout and a migration.
- **Token-2022 transfer hooks.** A mint with an active hook needs accounts
  `agent_transfer_spl` does not pass, so the transaction reverts. That is
  safe, but unsupported.
- **Transfer-fee display.** A fee-bearing mint debits the vault by the capped
  amount and the recipient receives less. The card does not show the net yet.
- **Auto-signing.** Recurring buys produce proposals, and each one still needs
  your signature. This is by design.
- **Token-vault funding** has no product UI yet. It goes through scripts, or
  the demo faucet on devnet.
- **Rejected-action indexing.** The on-chain log records allowed actions.
  Rejections exist only as failed-transaction logs.

## License

The SDK is MIT-licensed ([sdk/LICENSE](sdk/LICENSE)).
