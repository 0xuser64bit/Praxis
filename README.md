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
2. The agent parses it into a typed action (Google Gemini, or a local
   deterministic parser for $0 demos).
3. Recipient names resolve through an off-chain address book.
4. The action is simulated and checked against the policy, producing a proposal
   card with the fee, the simulation result, and the Aegis verdict.
5. On confirm, the backend signs an Aegis instruction with the **scoped agent
   key** and submits it.
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

## Future scope

Praxis is a strong devnet MVP. The production seams — managed Postgres state,
wallet-signed owner actions, remote agent-key custody, cross-instance rate
limiting, structured logging — are all in place and switch on by configuration.

Deliberately **not** built yet:

- **Real swaps.** Swap intents are parsed and previewed, but always blocked.
  There is no Jupiter CPI and no `agent_swap` instruction. A real swap path must
  enforce mint/program allow-lists and value caps *inside the program*, not in a
  quote or backend — that is the bar for adding it.
- Scheduled / DCA actions — only with mechanical triggers and the same Aegis
  envelope.
- Wallet-signed SPL token-envelope setup and managed vault-funding UX.
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
bun run aegis:test # rebuild the Anchor program + run the LiteSVM enforcement gate
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
