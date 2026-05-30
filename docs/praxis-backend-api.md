# Praxis Backend Agent API

The backend implements the `PraxisProvider` seam from `shared/src/provider.ts`.
All money crosses JSON as integer decimal strings; in memory it is `bigint`.

## Security boundary

API mode uses wallet ownership as the user boundary.

- `POST /api/praxis/auth/challenge` creates a short-lived sign-in message for
  a Solana wallet address.
- `POST /api/praxis/auth/verify` verifies the wallet signature and sets a
  signed, HTTP-only session cookie.
- All `/api/praxis/*` read and mutation routes require that session.
- Every mutation route also requires a same-origin browser request when an
  `Origin` header is present.
- Auth, read, mutation, and agent-send routes have rate limits. Use
  `PRAXIS_RATE_LIMITER=redis` for cross-instance enforcement.

The signed-in wallet derives the live policy PDA and scopes the off-chain
workspace. Backend owner-key routes are allowed only when `PRAXIS_OWNER_KEYPAIR`
matches the signed-in wallet; browser flows build wallet-signed owner/admin
transactions so the backend does not need the owner private key.
Fresh wallets can use the same wallet-signed transaction path with
`{ "kind": "bootstrapPolicy" }` to initialize their policy PDA and fund the SOL
vault.

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
- `GET /api/praxis/auth/session`
- `DELETE /api/praxis/auth/session`
- `POST /api/praxis/auth/challenge` with `{ "address": string }`
- `POST /api/praxis/auth/verify` with `{ "address": string, "nonce": string, "signature": string }`
- `POST /api/praxis/send` with `{ "threadId": string | null, "text": string }`
- `POST /api/praxis/sign-proposal` with `{ "proposalId": string }`
- `POST /api/praxis/cancel-proposal` with `{ "proposalId": string }`
- `POST /api/praxis/new-thread` with optional `{ "threadId": string }`
- `POST /api/praxis/update-policy` with `{ "patch": { "maxPerTx"?: string, "dailyLimit"?: string, "expiryTs"?: number, "paused"?: boolean } }`
- `POST /api/praxis/configure-token` with `{ "config": { "tokenMint": string, "tokenMaxPerTx": string, "tokenDailyLimit": string } }`
- `POST /api/praxis/prepare-token-accounts` with `{ "recipientAddresses"?: string[] }`
- `POST /api/praxis/bootstrap-policy`
- `POST /api/praxis/revoke-agent`
- `POST /api/praxis/rotate-agent`
- `POST /api/praxis/add-to-allow-list` with `{ "kind": "programs" | "recipients" | "mints", "address": string }`
- `POST /api/praxis/remove-from-allow-list` with the same body as add
- `POST /api/praxis/owner/build` with a typed owner action (`bootstrapPolicy`, `updatePolicy`, `allowList`, `revoke`, or `rotate`); returns an unsigned transaction for the wallet
- `POST /api/praxis/owner/submit` with the wallet-signed transaction and blockhash metadata

Request bodies are capped at 64 KiB. `send.text` is capped at 2,000 characters,
and client-supplied thread ids are capped at 128 characters.

## Environment

Copy `.env.example` and fill in:

- `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` for Messages API intent parsing.
- `SOLANA_RPC_URL` for the target cluster.
- `PRAXIS_SESSION_SECRET` for stable wallet sessions.
- `PRAXIS_STATE_BACKEND=postgres` and `DATABASE_URL` for production state
  persistence. Use `PRAXIS_STATE_DIR` only for local/devnet filesystem state.
- `PRAXIS_AGENT_KEYPAIR_PATH` or `PRAXIS_AGENT_KEYPAIR` for the scoped agent signer.
- `PRAXIS_ALLOW_LOCAL_AGENT_KEY=1` only for devnet/judge deployments that
  intentionally keep the agent key in-process; production custody should use
  `PRAXIS_AGENT_SIGNER_URL`.
- `PRAXIS_NEXT_AGENT_KEYPAIR_PATH` or `PRAXIS_NEXT_AGENT_KEYPAIR` for `rotate-agent`; it must be different from the current agent key.
- Optional `PRAXIS_OWNER_KEYPAIR_PATH` / `PRAXIS_OWNER_KEYPAIR` for local/devnet server-side policy admin routes. It must match the signed-in wallet.
- Optional `PRAXIS_ADDRESS_BOOK` for off-chain labels.
- Optional `PRAXIS_LLM_TIMEOUT_MS`, `PRAXIS_RPC_READ_TIMEOUT_MS`, and
  `PRAXIS_INDEXER_TIMEOUT_MS` to tune external-call deadlines.

The agent executor only signs `agent_transfer` and `agent_transfer_spl` through
Aegis. It never builds raw transfers outside the program. Swaps are represented
as typed, blocked `swap` proposal stubs; no Jupiter CPI is built or signed.

`configure-token` prepares the vault associated token account when backend owner
signing is available. `prepare-token-accounts` idempotently creates the vault
and supplied recipient ATAs for the configured token mint.

## Demo

Run:

```bash
bun scripts/praxis-demo.ts
```

With a local validator and owner/agent keypairs, the script initializes a demo
policy if needed, funds the vault, prints the `send 0.5 sol to maya` preview and
confirmation, then sends an over-cap transfer with preflight skipped so Aegis
returns its typed rejection reason.

For SPL account setup:

```bash
bun run praxis:setup-token-accounts
```

Set `PRAXIS_TOKEN_VAULT_FUND_AMOUNT` to fund the token vault from the owner ATA.
