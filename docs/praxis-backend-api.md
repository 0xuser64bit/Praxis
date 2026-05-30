# Praxis Backend Agent API

The backend implements the `PraxisProvider` seam from `shared/src/provider.ts`.
All money crosses JSON as integer decimal strings; in memory it is `bigint`.

## Security boundary

Every `POST` route requires:

- a same-origin browser request, when an `Origin` header is present
- `x-praxis-demo-token` matching `PRAXIS_DEMO_MUTATION_TOKEN`

The browser client sends that header from `NEXT_PUBLIC_PRAXIS_DEMO_MUTATION_TOKEN`
in API mode. This is a local-demo guard, not production auth. A production build
must replace it with wallet/session authorization and owner-signed policy/admin
transactions.

## Routes

- `GET /api/praxis/get-threads`
- `GET /api/praxis/get-thread?id=<threadId>`
- `GET /api/praxis/get-proposal?id=<proposalId>`
- `GET /api/praxis/get-policy`
- `GET /api/praxis/get-activity`
- `GET /api/praxis/get-address-book`
- `GET /api/praxis/is-thinking?threadId=<threadId>`
- `GET /api/praxis/get-version`
- `GET /api/praxis/subscribe` returns polling metadata for `get-version`
- `POST /api/praxis/send` with `{ "threadId": string | null, "text": string }`
- `POST /api/praxis/sign-proposal` with `{ "proposalId": string }`
- `POST /api/praxis/cancel-proposal` with `{ "proposalId": string }`
- `POST /api/praxis/new-thread` with optional `{ "threadId": string }`
- `POST /api/praxis/update-policy` with `{ "patch": { "maxPerTx"?: string, "dailyLimit"?: string, "expiryTs"?: number, "paused"?: boolean } }`
- `POST /api/praxis/configure-token` with `{ "config": { "tokenMint": string, "tokenMaxPerTx": string, "tokenDailyLimit": string } }`
- `POST /api/praxis/revoke-agent`
- `POST /api/praxis/rotate-agent`
- `POST /api/praxis/add-to-allow-list` with `{ "kind": "programs" | "recipients" | "mints", "address": string }`
- `POST /api/praxis/remove-from-allow-list` with the same body as add

Request bodies are capped at 64 KiB. `send.text` is capped at 2,000 characters,
and client-supplied thread ids are capped at 128 characters.

## Environment

Copy `.env.example` and fill in:

- `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` for Messages API intent parsing.
- `SOLANA_RPC_URL` for the target cluster.
- `PRAXIS_AGENT_KEYPAIR_PATH` or `PRAXIS_AGENT_KEYPAIR` for the scoped agent signer.
- `PRAXIS_NEXT_AGENT_KEYPAIR_PATH` or `PRAXIS_NEXT_AGENT_KEYPAIR` for `rotate-agent`; it must be different from the current agent key.
- `AEGIS_POLICY_ADDRESS`, or `AEGIS_OWNER_ADDRESS`, or an owner keypair so the server can locate the policy PDA.
- Optional `PRAXIS_OWNER_KEYPAIR_PATH` / `PRAXIS_OWNER_KEYPAIR` for server-side policy admin routes.
- Optional `PRAXIS_ADDRESS_BOOK` for off-chain labels.
- `PRAXIS_DEMO_MUTATION_TOKEN` and `NEXT_PUBLIC_PRAXIS_DEMO_MUTATION_TOKEN` for local API-mode demos.

The agent executor only signs `agent_transfer` and `agent_transfer_spl` through
Aegis. It never builds raw transfers outside the program. Swaps are represented
as typed, blocked `swap` proposal stubs; no Jupiter CPI is built or signed.

## Demo

Run:

```bash
bun scripts/praxis-demo.ts
```

With a local validator and owner/agent keypairs, the script initializes a demo
policy if needed, funds the vault, prints the `send 0.5 sol to maya` preview and
confirmation, then sends an over-cap transfer with preflight skipped so Aegis
returns its typed rejection reason.
