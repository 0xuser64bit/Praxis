# Deployment and operations

[Home](../README.md) / Operations · [User guide](GUIDE.md) · [Architecture](ARCHITECTURE.md)

Start here when you need real wallet authentication and chain interaction.
For a keyless UI sandbox, use the [mock quick-start](../README.md#run-it-locally).
The canonical configuration reference is [`.env.example`](../.env.example).

> These instructions target development and devnet first. A hosted web app is
> not, by itself, a production-ready financial deployment. Verify the deployed
> program, custody, storage, operational controls, and known gaps separately.
> Cluster scripts below may create accounts, spend SOL, or change policies.

## Local API mode on devnet

### 1. Install dependencies

Use Bun and Node.js 20.9+. The Solana CLI is needed to create/fund keys; Anchor
and Rust are only needed if building or deploying Aegis yourself. Requested
versions are Anchor **1.0.2** / Solana **3.1.15** in `aegis/Anchor.toml`, with
Rust `stable` in `aegis/rust-toolchain.toml`.

```bash
bun install --frozen-lockfile
(cd sdk && bun install --frozen-lockfile)
cp .env.example .env
```

If `.env` already exists, merge the required settings instead of overwriting
it. Never commit keypairs or populated environment files.

### 2. Create and fund the scoped agent

```bash
mkdir -p keys
solana-keygen new --no-bip39-passphrase -o keys/agent.json
solana-keygen new --no-bip39-passphrase -o keys/next-agent.json
solana airdrop 2 "$(solana-keygen pubkey keys/agent.json)" --url devnet
solana airdrop 2 "$(solana-keygen pubkey keys/next-agent.json)" --url devnet
```

The current agent pays agent-transfer fees. The next key is optional until
rotation/re-enable, but it also needs fee funds after rotation. Your connected
browser wallet pays for initialization, funding, and policy changes; give it
devnet SOL separately. Faucets may rate-limit; funding is not guaranteed.

### 3. Configure the API

Edit `.env`:

```dotenv
NEXT_PUBLIC_PRAXIS_PROVIDER=api
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
AEGIS_PROGRAM_ID=3z9GuipayYpAcPnjiwFkfe6gZvfSfuPZgX8djYu67Yhd
PRAXIS_AGENT_KEYPAIR_PATH=./keys/agent.json
PRAXIS_NEXT_AGENT_KEYPAIR_PATH=./keys/next-agent.json
PRAXIS_LOCAL_INTENT=1
PRAXIS_STATE_BACKEND=fs
```

The program ID is the repository's configured default, not a guarantee of
deployment availability. Check it on your target cluster:

```bash
solana program show 3z9GuipayYpAcPnjiwFkfe6gZvfSfuPZgX8djYu67Yhd --url devnet
```

Local development can use an ephemeral session secret. For stable sessions,
generate a random value with `openssl rand -base64 32` and set
`PRAXIS_SESSION_SECRET`. A configured secret must be at least 32 characters.
`PRAXIS_LOCAL_INTENT=1` skips model calls; to use external parsing, set it to
`0` and supply `GEMINI_API_KEY` and/or `GROQ_API_KEY`.

Leave `PRAXIS_OWNER_KEYPAIR*` empty for the browser-wallet flow. The backend
does not need your owner private key. Those variables are for explicit
server-key scripts/admin flows, not normal hosted user custody.

### 4. Run and initialize

```bash
bun run dev
curl --fail http://localhost:3000/api/health
```

Run the health request from another terminal. It should return `{"ok":true}`;
it proves routing/liveness, **not** RPC, database, signer, or policy readiness.
Open http://localhost:3000/app with a devnet wallet and follow
[your first transfer](GUIDE.md#your-first-devnet-transfer). Contacts start empty by default.
State is stored under `.praxis/state` unless configured otherwise.

### Optional: local Postgres and Redis

```bash
docker compose up -d
bun run praxis:localcheck
```

Then set:

```dotenv
DATABASE_URL=postgresql://praxis:praxis@localhost:5433/praxis
PRAXIS_STATE_BACKEND=postgres
PRAXIS_PG_DRIVER=pg
REDIS_URL=redis://localhost:6379
PRAXIS_RATE_LIMITER=redis
```

Postgres uses **host port 5433**; Redis uses **6379**. The schema initializes
on first use. `localcheck` writes/deletes dedicated check records. Restart the
app after changing configuration. `docker compose down` preserves named
volumes; `docker compose down -v` destroys local database/Redis data.

## Hosting on Vercel

Install dependencies with Bun, including the separate SDK install, and build
with `bun run build`. Configure environment values **before building**; public
variables are embedded in the frontend. Use `bun run start` for a self-hosted
production server instead of the development command.

| Setting | Required configuration |
| --- | --- |
| Frontend | `NEXT_PUBLIC_PRAXIS_PROVIDER=api`, `NEXT_PUBLIC_SOLANA_CLUSTER=devnet` for a devnet deployment, `NEXT_PUBLIC_SITE_URL` set to the apex HTTPS origin |
| Chain | `SOLANA_RPC_URL`, matching `AEGIS_PROGRAM_ID`; funded agent key; funded owner wallets |
| Sessions | Random `PRAXIS_SESSION_SECRET` (32+ characters); default TTL 24 hours |
| State | `DATABASE_URL` and explicit `PRAXIS_STATE_BACKEND=postgres` |
| SQL transport | Neon HTTP by default for remote URLs; set `PRAXIS_PG_DRIVER=pg` for ordinary remote Postgres |
| Shared replay protection | `REDIS_URL` **or** complete `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`; do not use process-local nonces in production |
| Parsing | Supported model keys, or explicit `PRAXIS_LOCAL_INTENT=1` |
| Custody | Remote signer URL, public key, bearer token; [details below](#production-agent-key-custody) |

Do not copy the local template unchanged: it explicitly pins filesystem state
and a local RPC URL. A database URL alone does not override an explicit `fs`.
Serverless filesystem state is ephemeral and per-instance. Production refuses
to silently choose filesystem storage or local replay protection.

Choose RPC and storage capacity for your load. Model aliases, provider quotas,
cloud pricing, and hosting-plan limits are external contracts; verify them
with the provider rather than relying on historical free-tier measurements.

### App subdomain

One deployment can serve the landing site and product. `proxy.ts` and
`server/web/hostRouting.ts` derive host routing from `NEXT_PUBLIC_SITE_URL`.

| Request, for apex `usepraxis.fun` | Result |
| --- | --- |
| `app.usepraxis.fun/` | Rewrites internally to `/app` |
| `app.usepraxis.fun/app/*` | Redirects to the clean `/*` path |
| `usepraxis.fun/app*` | Redirects to the app host |
| `www.usepraxis.fun/*` | Redirects to the apex |
| `/api/*` on any host | Passes through; app and API remain same-origin |
| `localhost`, preview hosts | No production-host rewrite; `app.localhost` supports local split-host testing |

Add the apex and app domains to the hosting project and use the DNS records
the host supplies. Keep `NEXT_PUBLIC_SITE_URL` on the apex. Test the redirect
and app-host health endpoint after deployment; a healthy apex alone is not
proof the product host works. No cross-origin browser SDK deployment is supported.

## Production agent-key custody

Run the [standalone signer](../signer/README.md) on a separate trusted host.
It holds the agent key; the app holds only:

```dotenv
PRAXIS_AGENT_SIGNER_URL=https://signer.example.com/sign
PRAXIS_AGENT_PUBLIC_KEY=<agent-public-key>
PRAXIS_AGENT_SIGNER_TOKEN=<same-secret-as-SIGNER_TOKEN>
PRAXIS_NEXT_AGENT_PUBLIC_KEY=<next-agent-public-key>
```

The next public key is needed for rotation, not initial operation. Replace the
illustrative values; remove `PRAXIS_AGENT_KEYPAIR*` from the app host and leave
`PRAXIS_ALLOW_LOCAL_AGENT_KEY` unset. The signer host needs the complete
checkout because it imports shared server code.

Custody isolation removes direct app-host access to the raw key, not the
app's ability to request permitted signatures. A stolen signer token can still
authorize recognized Aegis transfers. A shared agent key creates shared risk
across the policies that register it, even behind a signer. Protect transport,
limit access, monitor logs, and keep per-policy caps conservative.

The local-key production escape hatch requires
`PRAXIS_ALLOW_LOCAL_AGENT_KEY=1` plus a configured single owner, or explicit
`PRAXIS_ALLOW_SHARED_AGENT_KEY=1`. These are risk acknowledgments, not the
recommended production path. Never set them just to silence a setup error.

`scripts/oracle-vm-setup.sh` is an **optional provisioning script**, not a
prerequisite. Review it before running on a fresh Linux VM: it uses `sudo`,
installs Bun, generates custody material, writes `/etc/praxis-signer.env`,
creates a systemd unit, and configures a Cloudflare Tunnel workflow. It prints
sensitive configuration; do not paste that output into issues or logs. Verify
provider availability and costs independently.

Rotation must coordinate the on-chain authority and signer that can use the
new key. Fund the new key, register its public key via an owner transaction,
and configure the signer for that authority. A revoked key cannot be restored
by clearing pause alone.

## Enabling stocks

Set `PRAXIS_STOCKS_ENABLED=1`; it merges eight pinned stock tokens into the
catalog. Do not duplicate them in `PRAXIS_TOKENS`. Set an optional display
filter with `PRAXIS_STOCK_UNIVERSE`. Read the
[stock semantics](GUIDE.md#stock-token-workflows) before presenting “buys” to users.

### Devnet mirror mints

The configured real stock mints are mainnet references. To create stand-ins on
devnet, use a **disposable funded owner/mint-authority key**, not a user's key:

```bash
solana-keygen new --no-bip39-passphrase -o keys/mirror-authority.json
solana airdrop 2 "$(solana-keygen pubkey keys/mirror-authority.json)" --url devnet
SOLANA_RPC_URL=https://api.devnet.solana.com \
PRAXIS_OWNER_KEYPAIR_PATH=./keys/mirror-authority.json \
  bun run praxis:setup-devnet-stocks
```

This creates eight Token-2022 mints and initial supply. Save the printed
`PRAXIS_STOCK_MINTS` / `PRAXIS_STOCK_DECIMALS` configuration; rerunning creates
new mints. Mirrors use nine decimals and do not reproduce issuer privileges.
Keep their mint authority secure.

For local demo funding, set
`PRAXIS_DEMO_FAUCET_KEYPAIR_PATH=./keys/mirror-authority.json`. Hosted instances
need the corresponding secret **value** in `PRAXIS_DEMO_FAUCET_KEYPAIR`, not a
path on your laptop. The faucet requires the correct mirror authority, refuses
mainnet and non-mirror mints, and permits three grants per wallet per day. Its
key pays rent and fees. Without it, arrange token-vault funding separately.

Configure the active stock envelope in the app, fund the vault, and perform a
small transfer. `praxis:stocksbuycheck` is an additional **state-changing**
operator check: inspect its key/config requirements before running.

### Scheduled recurring buys

`vercel.json` defines a daily `/api/cron/stocks` tick at **09:00 UTC**. Set
`PRAXIS_SCHEDULE_HOUR_UTC=9` to match. If you change the cron expression, change
the setting too; otherwise a promised weekday can slip to the following tick.

Set `CRON_SECRET` to a random value of at least 16 characters. A scheduler must
send `Authorization: Bearer <secret>`. Without a configured secret, all-wallet
scheduler access is unavailable; an authenticated owner can still manually
fire their own schedules through the session path. A wrong bearer token is
rejected, never silently downgraded to a session call.

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://your-deployment.example/api/cron/stocks
```

Export `CRON_SECRET` in that shell first; `curl` does not load `.env`. This is
a mutating check: it can advance schedules and create proposals. A scheduler
success contains `scope`, `wallets`, `walletsFired`, `proposals`, and `failures`.
It does **not** prove any transfer was signed. The runner processes at most
500 wallets and isolates failures per wallet. Review `schedules.wallet_failed`
and `schedules.run_complete` logs.

## Deploying or upgrading Aegis

Skip this section if using a verified existing deployment. These commands
require the pinned toolchain, a funded deployment wallet, and appropriate
upgrade authority. Never point a deployment command at mainnet accidentally.

For your own devnet program:

```bash
cd aegis
NO_DNA=1 anchor build --ignore-keys
anchor keys sync
NO_DNA=1 anchor build
anchor deploy --provider.cluster devnet
anchor keys list
cd ..
bun run aegis:idl
```

Set `AEGIS_PROGRAM_ID` to the resulting ID, update signer configuration if
used, and verify the generated IDL/client match. The initial build produces
the program keypair; `anchor keys sync` aligns declared IDs. Key sync may
modify tracked configuration. Review those changes before deployment.

For an upgrade, save the existing binary with `solana program dump`, inspect
program size/authority with `solana program show`, and plan a compatible
app/program rollout. If account layout changes, plan a migration, not just an
IDL copy. Binary size growth may require `solana program extend` and rent.
Priority-fee and retry options depend on the pinned CLI; inspect
`solana program deploy --help` before choosing them.

After a failed deploy, inspect loader buffers and balances before trying
again. Do not deploy an unverified partly written buffer or close unfamiliar
accounts to reclaim rent. A binary rollback cannot automatically undo an
account migration. Run focused enforcement tests before deployment and small
funded-cluster checks after it.

## Verifying a cluster

Run commands from the repository root. Review each script before using a live
wallet; these are not read-only health checks unless stated.

| Command (`bun run …`) | Needs / effect |
| --- | --- |
| `check`, `praxis:stocksgate` | Web/SDK CI gates; no chain credentials. Fresh installs/font builds can need network. |
| `praxis:moneyshots`, `praxis:swapcheck`, `praxis:tokencheck` | Offline mock/policy checks, not on-chain proofs |
| `praxis:localcheck` | Local Docker Postgres + Redis; writes and cleans dedicated records |
| `praxis:stockscheck` | Network; compares external PreStocks API with pinned universe |
| `praxis:demo` | Funded owner/agent, deployed program; initializes/funds policy if needed and sends SOL |
| `praxis:demo -- --stocks` | Adds research, stock simulation, block, and pause/resume flows |
| `praxis:stocksbuycheck` | Funded operator keys and mirror-stock config; configures/funds a token path and executes a transfer plus an on-chain rejection |
| `praxis:setup-token-accounts` | Creates configured token accounts; `PRAXIS_TOKEN_VAULT_FUND_AMOUNT` optionally funds the vault from the owner |
| `praxis:stocks-dca -- --list` | Lists the configured owner's schedules |
| `praxis:stocks-dca -- --fire` | Claims due schedules and builds proposals, never signs |
| `praxis:policycheck` | Local validator + smoke keys; owner policy changes |
| `praxis:reenablecheck`, `praxis:reenablecycles` | Local validator + smoke keys; transfer, revoke, rotate, transfer (`CYCLES=3` for repeated cycles) |

Scripts requiring server-side owner authority use `PRAXIS_OWNER_KEYPAIR*`;
smoke scripts use `SMOKE_OWNER`, `SMOKE_AGENT`, `SMOKE_NEXT_AGENT`. Inspect
their defaults before use: some default to local `/tmp` key paths. These keys
are separate from browser sign-in and are not generated by `bun install`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No policy account | Initialize from `/app`; confirm wallet, RPC cluster, and program ID match. |
| Generic 503 / configuration error | Read server logs. Secrets and internal config names are intentionally redacted from API errors. |
| Production sign-in fails | Session secret and complete Redis/Upstash replay-protection config; shared store availability. |
| Threads disappear across requests | Use Postgres, not serverless filesystem state. Check the explicit `PRAXIS_STATE_BACKEND`. |
| Remote Postgres connection fails | Use the correct `PRAXIS_PG_DRIVER`; a generic Postgres server may need `pg` rather than Neon HTTP. |
| Transfers fail before confirmation | Agent fee balance, matching active authority, vault funds, caps, expiry, recipient list, mint and token accounts. |
| Re-enable fails | Next key/public key configured, funded, and usable by the signer after rotation. |
| Research lacks concentration data | Inspect RPC response/limits; missing data is disclosed, not estimated. |
| Parsing becomes rigid | Check `intent.provider_failed` and `intent.all_providers_failed_fallback_local`; verify current model availability, credentials, and limits. |
| Schedule never fires | Scheduler auth, matching UTC hour, stored schedule, active mint, and runner failure logs. |
| A proposal stays submitted | Reconcile the transaction signature. Do not reset it to pending or retry a replacement blindly. |

Ship structured application and signer logs to durable storage; never log
credentials. Monitor `praxis.submitted_unknown`, configuration failures,
signer refusals/rate limits, and scheduler failures. Back up Postgres and test
recovery. Health-endpoint uptime alone is not operational readiness.
