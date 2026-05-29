# Praxis

Praxis is a conversational Solana agent demo backed by Aegis, an Anchor
program that enforces a scoped agent policy on-chain.

The current product supports:

- A polished standalone mock walkthrough at `/app`.
- A live API mode for native SOL `agent_transfer` through Aegis.
- Policy dashboard controls for caps, expiry, allow-lists, revoke, and rotate.
- Activity and proposal surfaces that show Aegis policy verdicts.
- Read-only token research through Solana RPC and a configured indexer.

Swaps are intentionally a typed stub. No Jupiter CPI or owner-signed swap flow is
implemented yet.

## Modes

### Mock mode

Use this for a standalone product walkthrough. It does not need keypairs, RPC, or
Anthropic credentials.

```bash
NEXT_PUBLIC_PRAXIS_PROVIDER=mock bun run dev
```

Open `http://localhost:3000/app`.

### Live API mode

Use this for the real Aegis send flow on localnet/devnet. Copy `.env.example`,
then configure:

- `NEXT_PUBLIC_PRAXIS_PROVIDER=api`
- `PRAXIS_DEMO_MUTATION_TOKEN`
- `NEXT_PUBLIC_PRAXIS_DEMO_MUTATION_TOKEN` with the same local-demo value
- `SOLANA_RPC_URL`
- `PRAXIS_AGENT_KEYPAIR_PATH` or `PRAXIS_AGENT_KEYPAIR`
- `AEGIS_POLICY_ADDRESS`, `AEGIS_OWNER_ADDRESS`, or `PRAXIS_OWNER_KEYPAIR_PATH`
- `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`, unless using `PRAXIS_LOCAL_INTENT=1`

The demo mutation token is not production authentication. It only prevents an
accidental public deployment from exposing server-side signer routes.

```bash
bun run dev
```

Open `http://localhost:3000/app`.

## Validation

```bash
bun run lint
bun run build
bun run aegis:test
```

`bun run aegis:test` rebuilds the Anchor program before running the LiteSVM
enforcement gate.

## Demo Script

With a local validator and funded owner/agent keypairs:

```bash
bun run praxis:demo
```

The script initializes a demo policy if needed, funds the vault, previews and
executes `send 0.5 sol to maya`, then submits an over-cap transfer so Aegis
returns a typed rejection.

## Production Gap

This repo is now demo-ready, not production-ready. Before production, owner
policy actions must be wallet-signed, user/session auth must replace the demo
mutation token, durable storage must replace the in-memory provider, and API
routes need per-user authorization and rate limits.
