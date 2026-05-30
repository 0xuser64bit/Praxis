# Praxis

Praxis is a conversational Solana agent demo backed by Aegis, an Anchor
program that enforces a scoped agent policy on-chain.

The current product supports:

- A polished standalone mock walkthrough at `/app`.
- A live API mode for native SOL `agent_transfer` and configured SPL-token
  `agent_transfer_spl` through Aegis.
- Policy dashboard controls for caps, expiry, allow-lists, revoke, and rotate.
- Activity and proposal surfaces that show Aegis policy verdicts.
- Read-only token research through Solana RPC and a configured indexer.

Swaps are intentionally a typed stub. No Jupiter CPI or owner-signed swap flow is
implemented yet, and the mock refuses to sign swaps too.

## Modes

### Mock mode

Use this for a standalone product walkthrough. It does not need keypairs, RPC, or
Anthropic credentials.

```bash
NEXT_PUBLIC_PRAXIS_PROVIDER=mock bun run dev
```

Open `http://localhost:3000/app`.

### Live API mode

Use this for the real Aegis send flow on localnet/devnet. API mode now requires
wallet sign-in; the signed-in wallet address derives the Aegis policy PDA and
scopes the off-chain workspace state. Copy `.env.example`, then configure:

- `NEXT_PUBLIC_PRAXIS_PROVIDER=api`
- `PRAXIS_SESSION_SECRET` for stable signed sessions
- `PRAXIS_STATE_DIR` for local/devnet workspace persistence
- `SOLANA_RPC_URL`
- `PRAXIS_AGENT_KEYPAIR_PATH` or `PRAXIS_AGENT_KEYPAIR`
- `PRAXIS_NEXT_AGENT_KEYPAIR_PATH` or `PRAXIS_NEXT_AGENT_KEYPAIR` for
  rotate/re-enable; it must be different from the current agent key
- `PRAXIS_OWNER_KEYPAIR_PATH` is optional and only for the local/devnet
  backend-keypair fallback (and scripts); it must match the wallet you sign in
  with
- `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`, unless using `PRAXIS_LOCAL_INTENT=1`

Owner/admin policy actions (update caps/expiry/pause, allow-lists, revoke,
rotate) are **wallet-signed** when a signing wallet is present: the server builds
an unsigned transaction, the wallet signs it, and the server submits it — the
backend never holds the owner key. The backend owner keypair remains only as a
local/devnet fallback when no browser wallet can sign (and for scripts). Token
envelope setup/funding still uses the backend keypair and stays a local/devnet
convenience.

```bash
bun run dev
```

Open `http://localhost:3000/app`.

## Validation

```bash
bun run lint
bun run test
bun run build
bun run aegis:test
```

`bun run test` runs the TypeScript suite (auth/session, wallet challenge, request
validation, rate limiting, state persistence, the Aegis codec, env parsing, the
server provider against a fake Aegis client, and the API route auth/validation
seams) — no validator or network required. `bun run aegis:test` rebuilds the
Anchor program before running the LiteSVM enforcement gate.

## Demo Script

With a local validator and funded owner/agent keypairs:

```bash
bun run praxis:demo
```

The script initializes a demo policy if needed, funds the vault, previews and
executes `send 0.5 sol to maya`, then submits an over-cap transfer so Aegis
returns a typed rejection.

For SPL sends, prepare the configured token vault and known recipient associated
token accounts:

```bash
bun run praxis:setup-token-accounts
```

Set `PRAXIS_TOKEN_VAULT_FUND_AMOUNT` to transfer tokens from the owner ATA into
the vault ATA during setup.

## Production Gap

This repo is a strong local/devnet MVP candidate. Managed state storage is now
available — set `PRAXIS_STATE_BACKEND=postgres` with a `DATABASE_URL` (Neon or
any Postgres) to persist threads/proposals/activity durably across instances;
the filesystem backend remains the default for local/devnet. Owner/admin policy
actions are already wallet-signed (above). Before production, also put the agent
session key in a real key-management boundary and add platform-level rate
limiting and monitoring.
