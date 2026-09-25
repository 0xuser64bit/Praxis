# Deploying and operating Praxis

This runbook covers four things: running Praxis locally against a real
cluster, hosting it on Vercel, enabling stocks, and moving the agent key into
production custody. Everything runs on free tiers and devnet SOL. For the
system design, see [ARCHITECTURE.md](ARCHITECTURE.md).

`.env.example` is the complete, commented variable reference. This document
covers only the variables you actually set.

## Local API mode on devnet

Mock mode needs none of this (see the [README](../README.md#development)).

### 1. Prerequisites

- [Bun](https://bun.sh), the [Solana CLI](https://docs.solana.com/cli/install)
  and [Anchor](https://www.anchor-lang.com/docs/installation), at the versions
  pinned in `aegis/Anchor.toml`.
- A browser wallet (Phantom) switched to **devnet**.

```bash
solana config set --url https://api.devnet.solana.com
```

### 2. Deploy the Aegis program

You can skip this step and use the existing devnet deployment
(`3z9GuipayYpAcPnjiwFkfe6gZvfSfuPZgX8djYu67Yhd`, the default
`AEGIS_PROGRAM_ID`). To deploy your own:

```bash
cd aegis
anchor build
anchor keys sync                       # align declare_id! with your program keypair
anchor build
solana airdrop 2                       # fund the deploy wallet (~/.config/solana/id.json)
anchor deploy --provider.cluster devnet
anchor keys list                       # the deployed program id → AEGIS_PROGRAM_ID
cd ..
bun run aegis:idl                      # re-sync the IDL into shared/ if the id changed
```

### 3. Create and fund the agent keypair

```bash
mkdir -p keys
solana-keygen new --no-bip39-passphrase -o keys/agent.json
solana-keygen new --no-bip39-passphrase -o keys/next-agent.json   # only for rotate / re-enable
solana airdrop 2 $(solana-keygen pubkey keys/agent.json) --url devnet
```

The agent pays the fees for agent transfers. The connected browser wallet pays
for policy initialization and vault funding. Fund both. `keys/` is gitignored.

### 4. Configure `.env`

```bash
cp .env.example .env
```

The values you usually edit:

```bash
NEXT_PUBLIC_PRAXIS_PROVIDER=api
SOLANA_RPC_URL=https://api.devnet.solana.com
AEGIS_PROGRAM_ID=<program id>
PRAXIS_AGENT_KEYPAIR_PATH=./keys/agent.json
PRAXIS_NEXT_AGENT_KEYPAIR_PATH=./keys/next-agent.json   # only for rotate / re-enable
PRAXIS_SESSION_SECRET=<openssl rand -base64 32>
PRAXIS_LOCAL_INTENT=1                                    # deterministic parser, no LLM key
```

To parse with an LLM instead, leave `PRAXIS_LOCAL_INTENT` unset and set
`GEMINI_API_KEY` and/or `GROQ_API_KEY`.

**Optional: production-like state.** `compose.yml` runs Postgres and Redis
locally:

```bash
docker compose up -d        # postgres on host port 5433, redis on 6379
bun run praxis:localcheck   # proves both backends, including write-conflict rejection
```

Then set `DATABASE_URL=postgresql://praxis:praxis@localhost:5433/praxis` with
`PRAXIS_STATE_BACKEND=postgres` (the copied `.env` pins `fs`), and
`REDIS_URL=redis://localhost:6379`. Without them, state goes to `.praxis/state`
and rate limits stay in memory.

### 5. Run it

```bash
bun run dev
```

Open <http://localhost:3000/app>, connect a devnet wallet and create your vault
when prompted. The wallet signs a transaction that creates its Aegis policy
PDA and funds the vault. Then try `send 0.5 sol to maya`.

## Hosting on Vercel

Import the repo and set the environment variables below. **Keys go in as
values, not file paths.** Vercel has no writable key files.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_PRAXIS_PROVIDER` | `api` |
| `NEXT_PUBLIC_SITE_URL` | The apex origin, e.g. `https://usepraxis.fun` |
| `SOLANA_RPC_URL` | Devnet public endpoint, or a Helius/QuickNode URL |
| `AEGIS_PROGRAM_ID` | Your program id |
| `PRAXIS_SESSION_SECRET` | Random string, at least 32 characters. Required in production. |
| `DATABASE_URL` | Neon (Vercel Marketplace) or any Postgres URL. The schema creates itself. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Shared rate limits and single-use sign-in nonces across instances |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | Intent parsing. Otherwise set `PRAXIS_LOCAL_INTENT=1`. |
| Agent key | See [agent-key custody](#production-agent-key-custody) |

Production refuses to fall back silently. With no `DATABASE_URL`, it requires
an explicit `PRAXIS_STATE_BACKEND=fs`, and filesystem state is per-instance and
ephemeral on Vercel. With no custody setup, it refuses a raw in-process agent
key.

### App subdomain

One project serves both hosts. `proxy.ts` routes each request by its `Host`
header. The routing table is unit-tested in
`server/web/__tests__/hostRouting.test.ts`.

| Request | Result |
|---|---|
| `app.usepraxis.fun/` | Serves the product app (rewritten from `/app`; the URL stays clean) |
| `app.usepraxis.fun/app/*` | 308 to `/*`, the one canonical URL |
| `usepraxis.fun/app*` | 308 to `app.usepraxis.fun/*`, so old links keep working |
| `www.usepraxis.fun/*` | 308 to the apex |
| `/api/*` on any host | Passes through. App and API stay same-origin, so cookies and CORS need no changes. |
| `*.vercel.app`, `localhost` | Untouched (`app.localhost` previews the split) |

To set it up, add `app.usepraxis.fun` under Settings → Domains, and add the DNS
record `CNAME app → cname.vercel-dns.com`. Keep `NEXT_PUBLIC_SITE_URL` on the
apex. The proxy derives the apex host from it.

```bash
curl -sI https://usepraxis.fun/app | grep -i location   # → https://app.usepraxis.fun/
curl -sI https://app.usepraxis.fun/api/health | head -1  # 200
```

## Enabling stocks

| Variable | Value |
|---|---|
| `PRAXIS_STOCKS_ENABLED` | `1`. This merges the eight PreStocks mints into the token list. |
| `PRAXIS_STOCK_MINTS` | Devnet only: the mirror-mint block described below |
| `CRON_SECRET` | Required, or recurring buys never fire (see below) |
| `PRAXIS_DEMO_FAUCET_KEYPAIR` | Optional, devnet only (see below) |

Do not list the stock symbols in `PRAXIS_TOKENS`. The flag adds them.

### Devnet mirror mints

The real PreStocks mints exist only on mainnet. On devnet, create Token-2022
stand-ins:

```bash
SOLANA_RPC_URL=https://api.devnet.solana.com \
PRAXIS_OWNER_KEYPAIR_PATH=./keys/owner.json \
  bun run praxis:setup-devnet-stocks     # creates 8 mints, prints the env block
```

Paste the printed `PRAXIS_STOCK_MINTS` / `PRAXIS_STOCK_DECIMALS` into the
deployment environment, then prove the path end to end with
`bun run praxis:stocksbuycheck`. A mirror mint reproduces the symbol, the 9
decimals and the Token-2022 program. It does not reproduce the issuer's
authorities. The UI labels a mirrored universe.

**Demo faucet.** Only the operator's wallet holds mirror stock, so any other
wallet can configure an envelope but never complete a buy. Set
`PRAXIS_DEMO_FAUCET_KEYPAIR` to the contents of `keys/owner.json`, which holds
the mint authority. Policy → Token transfers then offers
**$1,000 demo \<STOCK\>**, which mints the active mirror into the signed-in
wallet's vault. The faucet refuses real mints and refuses mainnet. It allows 3
grants per wallet per day. Its key pays rent, so keep it funded with devnet
SOL.

### Scheduled recurring buys

`vercel.json` schedules `/api/cron/stocks` daily at 09:00 UTC. The Vercel Hobby
plan allows only daily crons, and runs them anywhere within the hour. The
runner fires everything due up to the current time, so that delay is harmless.

- **`PRAXIS_SCHEDULE_HOUR_UTC` must match the cron hour** (default `9`). New
  schedules anchor their fire time to it. A schedule timed after the tick is
  not due when the tick runs, so "every Monday" would fire on Tuesday. If you
  move the cron, move this setting with it.
- **Set `CRON_SECRET`** (16+ characters). Vercel Cron sends it as
  `Authorization: Bearer $CRON_SECRET`. Without it the endpoint is disabled,
  not open. That is safe, but the UI will have promised schedules that never
  fire.

The job fans out across every wallet with stored state. It emits one proposal
per due schedule and never signs. Failures are isolated per wallet and counted.

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/stocks
# {"scope":"all-wallets","wallets":N,"walletsFired":0,"proposals":0,"failures":0}
# 401 = secret mismatch, 503 = no secret configured
```

## Upgrading the Aegis program

When an upgrade changes an instruction's account list, deploy the program and
the app together. An old program with a new client fails, and so does a new
program with an old client. Take a rollback copy first:

```bash
PROGRAM=3z9GuipayYpAcPnjiwFkfe6gZvfSfuPZgX8djYu67Yhd
cd aegis && NO_DNA=1 anchor build && cd ..
solana program dump $PROGRAM aegis-predeploy.so --url devnet   # rollback copy
solana program show $PROGRAM --url devnet                      # compare with aegis/target/deploy/aegis.so size
```

If the new binary is larger than the program account, extend it first. The
loader requires **at least 10,240 additional bytes**. The extension costs rent
that is not refunded.

```bash
solana program extend $PROGRAM 16384 --url devnet
```

Deploy with a priority fee. Under devnet congestion, a plain deploy fails with
"Max retries exceeded" and leaves a partly written buffer behind.

```bash
solana program deploy aegis/target/deploy/aegis.so --program-id $PROGRAM --url devnet \
  --with-compute-unit-price 50000 --max-sign-attempts 60
bun run praxis:stocksbuycheck   # passes only against the new binary
```

Every failed deploy strands a buffer holding the rent for a program-sized
account, about 1.4 SOL for Aegis. Budget about 2 SOL of working room, and
reclaim stranded buffers before topping up the wallet. **Never** resume
from a partly written buffer. It may be incomplete, and deploying it would
install a corrupt program. Close it and deploy again.

```bash
solana program show --buffers --url devnet
solana program close <BUFFER_ADDRESS> --url devnet --bypass-warning
```

To roll back, deploy `aegis-predeploy.so` to the same program id.

## Production agent-key custody

Do not keep the agent private key in the Vercel environment, where any function
invocation can read it. Move signing behind the standalone signer
([signer/README.md](../signer/README.md)). The signer signs only single Aegis
agent transfers to the configured program, and the key never leaves its
process. The on-chain policy is still the authoritative enforcement. The signer
makes the key impossible to extract from the app host.

The cheapest durable home is an Oracle Cloud Always-Free VM behind a
Cloudflare Tunnel, which gives free HTTPS with no open inbound ports. The setup
script is idempotent:

```bash
# on a fresh Oracle Always-Free Ubuntu VM
git clone <your-repo-url> praxis && cd praxis
bash scripts/oracle-vm-setup.sh   # installs Bun, generates key + token, systemd unit, tunnel
```

It prints the values to set on Vercel:

```
PRAXIS_AGENT_SIGNER_URL=https://<your-tunnel-host>/sign
PRAXIS_AGENT_PUBLIC_KEY=<agent pubkey — not secret>
PRAXIS_AGENT_SIGNER_TOKEN=<same value as SIGNER_TOKEN on the VM>
```

Then remove `PRAXIS_AGENT_KEYPAIR` / `PRAXIS_AGENT_KEYPAIR_PATH` from Vercel and
leave `PRAXIS_ALLOW_LOCAL_AGENT_KEY` unset, so a raw in-process key is refused.
Fund the agent address with a little SOL for fees. For rotation under remote
custody, set `PRAXIS_NEXT_AGENT_PUBLIC_KEY`.

For a devnet-only deployment, you can instead set `PRAXIS_AGENT_KEYPAIR` to the
JSON array from `keys/agent.json` together with `PRAXIS_ALLOW_LOCAL_AGENT_KEY=1`.

## Verifying a cluster

CI runs `bun run check` and `bun run praxis:stocksgate`, both offline. The
scripts below need more than CI has.

| Command | Needs | Checks |
|---|---|---|
| `praxis:moneyshots` | nothing | The five core demo flows against the mock provider |
| `praxis:swapcheck` | nothing | The server rejects unverified-mint swaps |
| `praxis:tokencheck` | nothing | The off-chain SPL envelope check agrees with the program |
| `praxis:stockscheck` | network | The live PreStocks API still matches the pinned universe |
| `praxis:localcheck` | `docker compose up -d` | Postgres state (including write-conflict rejection) and the Redis limiter |
| `praxis:demo` | funded cluster | A SOL send, then an over-cap rejection. With `-- --stocks`: research, stock buy simulation, block, pause/resume |
| `praxis:stocksbuycheck` | funded cluster, stocks env | A stock buy lands, and an over-cap buy is refused on-chain |
| `praxis:policycheck` | local validator | A policy change made in chat lands on-chain |
| `praxis:reenablecheck` | local validator | Revoke, then re-enable. Signing follows the on-chain authority. |
| `praxis:reenablecycles` | local validator | The same, repeated (`CYCLES=3`) |

Setup helpers:

- `praxis:setup-token-accounts` creates the vault and recipient token accounts
  for the configured mint. With `PRAXIS_TOKEN_VAULT_FUND_AMOUNT=<n>` it also
  funds the token vault.
- `praxis:stocks-dca -- --list` / `-- --fire` inspects or fires the owner
  wallet's schedules without going through HTTP.

The local-validator smoke scripts read keypairs from `SMOKE_OWNER`,
`SMOKE_AGENT` and `SMOKE_NEXT_AGENT`.

## Environment variables you set

| Variable | Notes |
|---|---|
| `SOLANA_RPC_URL` | Target cluster. Use a paid endpoint for production traffic. |
| `AEGIS_PROGRAM_ID` | Defaults to the devnet deployment |
| `PRAXIS_SESSION_SECRET` | Required in production |
| `PRAXIS_SESSION_TTL_HOURS` | Default 24. A session can spend within the envelope, so keep it short. |
| `DATABASE_URL` | Postgres state. When set, the default backend is `postgres`. |
| `REDIS_URL` or `UPSTASH_REDIS_REST_URL`/`_TOKEN` | Shared rate limits and nonces. When set, the limiter defaults to Redis. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Model defaults to `gemini-flash-lite-latest`. Use a `-latest` alias, because a retired pinned model returns 404. On the free tier stay on flash-lite, because plain flash allows 20 requests a day. |
| `GROQ_API_KEY`, `GROQ_MODEL` | A second parser with its own free quota. Defaults to `openai/gpt-oss-120b`, which realistically gives about 4 parses a minute and about 100 a day. |
| `PRAXIS_INTENT_PROVIDERS` | Parse order before the local fallback (default `gemini,groq`). Providers without a key are skipped. |
| `PRAXIS_LOCAL_INTENT` | `1` skips the LLMs entirely (off by default) |
| `PRAXIS_RESEARCH_RPC_URL` | Read-only RPC for research. Stays on mainnet-beta, where the mints are. The public endpoint rate-limits `getTokenLargestAccounts`, so "Top 10 concentration" shows as unavailable there. |
| `PRAXIS_ADDRESS_BOOK` | JSON array of saved contacts. Empty by default in every environment; set it explicitly for operator-managed contacts. |

Watch the logs for `intent.provider_failed` and
`intent.all_providers_failed_fallback_local`. Parsing keeps working when every
LLM fails, just worse, so these events are the only signal that it happened.

## Troubleshooting

- **"Aegis policy account not found"**: create the vault from `/app`, and
  confirm the wallet is on devnet and supports transaction signing.
- **`PRAXIS_SESSION_SECRET is required in production`**: set it in the Vercel
  environment.
- **"No durable state backend in production"**: set `DATABASE_URL`, or
  explicitly set `PRAXIS_STATE_BACKEND=fs`.
- **Transfers fail before confirmation**: the agent keypair has no SOL for
  fees.
- **Threads disappear on Vercel**: filesystem state is per-instance. Use
  Postgres.
- **Program deploy fails**: the deploy wallet needs SOL, and `anchor keys sync`
  must have run so that `declare_id!` matches your program keypair. See
  [Upgrading the Aegis program](#upgrading-the-aegis-program) for failures
  under congestion.
