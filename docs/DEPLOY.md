# Deploying Praxis

This is the operational runbook: run locally, ship a live devnet build, and
move the agent key into production custody. Everything here runs on free tiers
and devnet faucet SOL, so the baseline cost is **$0**.

For the system design behind it, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Modes

| Mode | What it proves | Setup |
|---|---|---|
| **Mock** (`NEXT_PUBLIC_PRAXIS_PROVIDER=mock`) | UI and policy-preview ergonomics, no chain or keys | local only |
| **API** (`NEXT_PUBLIC_PRAXIS_PROVIDER=api`) | Real Aegis enforcement on a live cluster | the rest of this doc |

Production builds default to API mode. Mock mode is local/dev-only unless
`NEXT_PUBLIC_PRAXIS_ALLOW_MOCK=1` is set at build time.

```bash
# Mock — no RPC, keys, or LLM key needed
NEXT_PUBLIC_PRAXIS_PROVIDER=mock bun run dev
# open http://localhost:3000/app
```

---

## Live API on devnet

### 1. Prerequisites (all free)

- [Bun](https://bun.sh), the [Solana CLI](https://docs.solana.com/cli/install),
  and [Anchor](https://www.anchor-lang.com/docs/installation). This repo pins
  `anchor 1.0.1` / `solana 3.1.15` in `aegis/Anchor.toml`.
- A browser wallet (Phantom) switched to **devnet**.

```bash
solana config set --url https://api.devnet.solana.com
```

### 2. Deploy the Aegis program

```bash
cd aegis
anchor build
anchor keys sync                       # align declare_id! with your program keypair
anchor build
solana airdrop 2                       # fund the deploy wallet (~/.config/solana/id.json)
anchor deploy --provider.cluster devnet
anchor keys list                       # note the deployed program id
cd ..
```

Use that program id as `AEGIS_PROGRAM_ID` below.

### 3. Create and fund the agent keypair

```bash
mkdir -p keys
solana-keygen new --no-bip39-passphrase -o keys/agent.json
solana-keygen new --no-bip39-passphrase -o keys/next-agent.json   # only if demoing rotate
solana airdrop 2 $(solana-keygen pubkey keys/agent.json) --url devnet
```

The agent is the fee payer for `agent_transfer`, and the connected browser
wallet pays for policy init + vault funding — fund both. `keys/` is gitignored;
never commit keypairs.

### 4. Configure `.env`

```bash
cp .env.example .env
```

Local dependencies (Docker — Postgres + Redis for prod-parity state):

```bash
docker compose up -d   # postgres on :5433 (brew owns :5432), redis on :6379
bun run praxis:localcheck   # proves both backends against the live containers
```

Point `.env` at them: `DATABASE_URL=postgresql://praxis:praxis@localhost:5433/praxis`
with `PRAXIS_STATE_BACKEND=postgres`, plus `REDIS_URL=redis://localhost:6379` with
`PRAXIS_RATE_LIMITER=redis`. Hosted deploys keep Neon + Upstash REST — see
"Hosting on Vercel" below.

The only values you usually hand-edit:

```bash
NEXT_PUBLIC_PRAXIS_PROVIDER=api
SOLANA_RPC_URL=https://api.devnet.solana.com
AEGIS_PROGRAM_ID=<your program id from step 2>
PRAXIS_AGENT_KEYPAIR_PATH=./keys/agent.json
PRAXIS_NEXT_AGENT_KEYPAIR_PATH=./keys/next-agent.json   # only if demoing rotate
PRAXIS_SESSION_SECRET=<openssl rand -base64 32>
PRAXIS_LOCAL_INTENT=1                                    # $0 — deterministic parser, no LLM key
PRAXIS_STATE_BACKEND=fs                                  # local; use postgres on a real deploy
```

### 5. Verify locally

```bash
bun run dev
```

Open `http://localhost:3000/app`, connect a devnet wallet, and click
**Initialize devnet policy** if prompted — the wallet signs a transaction that
creates its Aegis policy PDA and funds the vault with 1 SOL. Then try
`send 0.5 sol to maya`.

---

## Hosting on Vercel

### App subdomain (`app.`)

One project serves both hosts; `proxy.ts` routes by `Host` header
(routing table unit-tested in `server/web/__tests__/hostRouting.test.ts`):

| Request | Result |
|---|---|
| `app.usepraxis.fun/` | serves the product app (`/app` rewrite, URL stays clean) |
| `app.usepraxis.fun/app/*` | 308 strips to `/*` (one canonical URL) |
| `usepraxis.fun/app*` | 308 redirects to `app.usepraxis.fun/*` (old links keep working) |
| `www.usepraxis.fun/*` | 308 canonicalizes to the apex |
| `/api/*` on any host | passes through (app + API stay same-origin — no cookie/CORS changes) |
| `*.vercel.app` previews, `localhost` | untouched (path routing, except `app.localhost` which previews the split) |

Setup (no code changes, no new env vars):

1. Vercel project → Settings → Domains → add `app.usepraxis.fun` (keep `usepraxis.fun`).
2. DNS: `CNAME app → cname.vercel-dns.com`.
3. `NEXT_PUBLIC_SITE_URL` stays the apex (`https://usepraxis.fun`) — the middleware
   derives the apex from it, and OG images keep one canonical base.

Verify:

```bash
curl -sI https://usepraxis.fun/app | grep -i location   # → https://app.usepraxis.fun/
curl -sI https://app.usepraxis.fun/ | grep -i "200\|rewrite"  # 200, product app HTML
curl -sI https://app.usepraxis.fun/api/health | head -1      # 200, same-origin API
```

Existing `/app` links (Nav CTA, README, SDK docs) need no edits — they redirect.
Point new external links (hackathon submission, socials) at `https://app.usepraxis.fun/`.
Import the repo and set Environment Variables. **Keys go in as values, not file
paths** — Vercel has no writable key files.

| Key | Value |
|---|---|
| `NEXT_PUBLIC_PRAXIS_PROVIDER` | `api` |
| `SOLANA_RPC_URL` | devnet public, or a free Helius/QuickNode devnet URL |
| `AEGIS_PROGRAM_ID` | your program id |
| `PRAXIS_SESSION_SECRET` | random 32+ char string |
| `PRAXIS_AGENT_KEYPAIR` | **contents** of `keys/agent.json` (the JSON array) — or use the signer below |
| `PRAXIS_ALLOW_LOCAL_AGENT_KEY` | `1` for devnet judging only; unset for production |
| `PRAXIS_STATE_BACKEND` | `postgres` |
| `DATABASE_URL` | Neon or any Postgres-compatible URL |
| `PRAXIS_ADDRESS_BOOK` | optional JSON array of saved contacts |

> On Vercel, `fs` state is per-instance and ephemeral. Use a free **Neon**
> database (Vercel Marketplace), set `PRAXIS_STATE_BACKEND=postgres` +
> `DATABASE_URL`, and the schema self-creates.

### Stocklana staging (submission preview)

Same project, these additions (values, not secrets — nothing sensitive here):

| Key | Value |
|---|---|
| `PRAXIS_STOCKS_ENABLED` | `1` (merges the 8 PreStocks mints; off = default app) |
| `PRAXIS_PRESTOCKS_API_URL` | default (`https://prestocks.com/api/prestocks`) — leave unset |
| `PRAXIS_STOCK_UNIVERSE` | leave unset (full universe) |
| `GEMINI_API_KEY` | set for free-form phrasing, or `PRAXIS_LOCAL_INTENT=1` for the deterministic parser |
| `NEXT_PUBLIC_PRAXIS_ALLOW_MOCK` | `0` (judges must hit the real API path) |

The 8 stock symbols come from the flag — do NOT list them in `PRAXIS_TOKENS`.

### Upgrade the program first (required — Token-2022 support)

The Aegis program on devnet predates Token-2022 support, so **a stock buy will
fail against it** no matter how the app is configured. The program is
upgradeable (`3z9Gui…`, authority `3bdgsL3Cipcq98aMWCw1c1G7W5KQ1yv4NfwieK8xb6CP`)
and the new binary is larger than the deployed one, so the account must be
extended before the upgrade:

```bash
cd aegis && NO_DNA=1 anchor build && cd ..
ls -l aegis/target/deploy/aegis.so                                             # 272,408 bytes
solana program show 3z9GuipayYpAcPnjiwFkfe6gZvfSfuPZgX8djYu67Yhd --url devnet  # 268,288 deployed

# The account is too small for the new binary, so extend it first. Skipping
# this step fails with:
#   Error: Max length specified not large enough to accommodate desired program
solana program extend 3z9GuipayYpAcPnjiwFkfe6gZvfSfuPZgX8djYu67Yhd 8192 --url devnet

solana program deploy aegis/target/deploy/aegis.so \
  --program-id 3z9GuipayYpAcPnjiwFkfe6gZvfSfuPZgX8djYu67Yhd --url devnet
```

Budget roughly **2 SOL** in the authority wallet: the deploy buffer is about
the size of the program (~1.9 SOL here) and is refunded when the upgrade
completes; the 8 KiB extend costs ~0.06 SOL and is not. If `extend` reports
`Program was extended in this block already`, wait a slot and re-run — it is a
same-block collision, not a failure.

This sequence was rehearsed end to end on a local validator against the same
binary: the undersized deploy is rejected, `extend` then `deploy --program-id`
upgrades in place, and `praxis:stocksbuycheck` passes against the result.

Confirm the upgrade landed with `praxis:stocksbuycheck` (below) — it fails
against the old binary and passes against the new one.

The instruction's account list changed (`agent_transfer_spl` now takes the
mint), so an old client against a new program, or the reverse, will fail.
Deploy the program and the app together.

### Devnet mirror mints (required for a devnet stock demo)

The real PreStocks mints exist on mainnet only. Before a devnet demo:

```bash
SOLANA_RPC_URL=https://api.devnet.solana.com \
PRAXIS_OWNER_KEYPAIR_PATH=./keys/owner.json \
  bun run praxis:setup-devnet-stocks     # creates 8 Token-2022 mints, prints the env block
```

Paste the printed `PRAXIS_STOCK_MINTS` / `PRAXIS_STOCK_DECIMALS` into the
deployment env. Then prove the path end to end:

```bash
bun run praxis:stocksbuycheck            # buy lands; over-cap refused on-chain
```

Mirrors reproduce symbol, decimals (9) and token program (Token-2022) — the
whole buy path — and not the issuer's permanent-delegate/freeze/pause
authorities. The app labels a mirrored universe in the UI.

### Scheduled recurring buys

`vercel.json` schedules `/api/cron/stocks` hourly. The job authenticates with
`Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this automatically from
the project's `CRON_SECRET`) and fans out across every wallet with stored
state, emitting one proposal per due schedule. It never signs — the owner still
signs every fire.

**Set `CRON_SECRET` whenever `PRAXIS_STOCKS_ENABLED=1`.** With no secret the
endpoint is disabled rather than open, which is the safe failure — but it also
means a user who schedules "buy $50 spacex every monday" will never receive a
proposal, and the UI will have promised them one.

Verify after deploy:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/stocks
# {"scope":"all-wallets","wallets":N,"walletsFired":0,"proposals":0,"failures":0}
```

A `401` means the secret does not match; a `503` means none is configured.
Per-wallet failures are isolated and counted, so one wallet with an
unreachable RPC cannot stop the rest of the run. The same endpoint still
answers a session cookie, firing only the signed-in wallet's schedules
(useful for manual catch-up and for SDK callers).

Cold-browser check before recording: research OPENAI → propose a buy →
over-cap buy blocked (off-chain card AND on-chain log) → switch envelope →
schedule a DCA → activity filtered by stock.

### Demo video shot list (90 seconds, human task)

1. Land on `https://app.<preview>/` → connect Phantom (devnet).
2. `research openai` → PreStocks rows render with attribution.
3. `buy $40 openai` → proposal with Aegis verdict → sign → Explorer link.
4. `buy $500 openai` → blocked card citing the 200/tx cap.
5. Policy → switch envelope to SPACEX (`vault · i of 8` label changes).
6. `buy $50 spacex every monday` → schedule notice (no signature asked).
7. Activity → filter by OPENAI. End on the blocked card (the pitch).

---

## Environment reference

Full inline docs live in `.env.example`. The variables you actually touch:

### You provide

| Variable | Notes |
|---|---|
| `SOLANA_RPC_URL` | Target cluster. Defaults to public devnet; use a paid endpoint for prod traffic. |
| `AEGIS_PROGRAM_ID` | The deployed Aegis program. |
| `PRAXIS_SESSION_SECRET` | Stable signed wallet sessions. Required in production. |
| `DATABASE_URL` | Durable prod state (threads/proposals/activity). Without it, state falls back to the filesystem (local/devnet only). |
| `GEMINI_API_KEY` | Intent parsing via the Google Gemini API. Omit and set `PRAXIS_LOCAL_INTENT=1` for the deterministic parser. |
| `PRAXIS_RESEARCH_RPC_URL` | Read-only RPC for token research. Tokens are mainnet mints, so this stays on **mainnet-beta** even when transfers run on devnet. |

### Agent key (one of)

| Variable | Notes |
|---|---|
| `PRAXIS_AGENT_KEYPAIR` / `PRAXIS_AGENT_KEYPAIR_PATH` | In-process agent key. Allowed in prod only with `PRAXIS_ALLOW_LOCAL_AGENT_KEY=1`. |
| `PRAXIS_AGENT_SIGNER_URL` + `PRAXIS_AGENT_PUBLIC_KEY` + `PRAXIS_AGENT_SIGNER_TOKEN` | Remote signer custody (below). The private key never lives in the app. |

### Safe defaults — leave alone unless you have a reason

| Variable | Default |
|---|---|
| `GEMINI_MODEL` | `gemini-2.5-flash` |
| `NEXT_PUBLIC_PRAXIS_PROVIDER` | `api` (`mock` is local-only) |
| `NEXT_PUBLIC_PRAXIS_ALLOW_MOCK` | `0` |
| `PRAXIS_STATE_BACKEND` | `postgres` if `DATABASE_URL` set, else `fs` |
| `PRAXIS_RATE_LIMITER` | `redis` if Upstash creds set, else in-memory |
| `PRAXIS_LOCAL_INTENT` | `1` locally — deterministic parser, no LLM key |
| `SOLANA_COMMITMENT` | `confirmed` |

Optional production toggles (no code changes): `PRAXIS_RATE_LIMITER=redis` +
`UPSTASH_REDIS_REST_URL/_TOKEN` for cross-instance rate limits.

---

## Production agent-key custody

In production you do **not** want the agent private key sitting in Vercel env,
where any function invocation can read it. Move signing behind the standalone
**signer service** (`signer/`): it accepts a transaction message, signs it only
if it is a single Aegis agent transfer to the configured program, and returns
the signature. The private key never leaves that process.

The cheapest durable home is an **Oracle Cloud Always-Free ARM VM** behind a
**Cloudflare Tunnel** (free HTTPS, no open inbound ports). A one-shot,
idempotent setup script does the whole thing:

```bash
# on a fresh Oracle Always-Free VM
git clone <your-repo-url> praxis && cd praxis
bash scripts/oracle-vm-setup.sh        # installs Bun, generates keys, systemd + tunnel
```

It prints the exact Vercel env vars to paste back:

```
PRAXIS_AGENT_SIGNER_URL=https://<your-tunnel-host>/sign
PRAXIS_AGENT_PUBLIC_KEY=<agent pubkey — not secret>
PRAXIS_AGENT_SIGNER_TOKEN=<same value as SIGNER_TOKEN on the VM>
```

Then on Vercel: **remove** `PRAXIS_AGENT_KEYPAIR` / `PRAXIS_AGENT_KEYPAIR_PATH`
and leave `PRAXIS_ALLOW_LOCAL_AGENT_KEY` unset, so a raw in-process key is
refused. Fund the agent address with a little SOL for fees.

This is defense-in-depth — the on-chain Aegis program is still the authoritative
enforcement. The signer just makes the key impossible to exfiltrate from the
host app. See [`signer/README.md`](../signer/README.md) for the wire contract
and how to delegate to a KMS/HSM later.

---

## Troubleshooting

- **"Aegis policy account not found"** → click **Initialize devnet policy** from
  `/app`; confirm the wallet supports transaction signing and is on devnet.
- **`PRAXIS_SESSION_SECRET is required in production`** → set it in Vercel env.
- **Transfers fail before confirmation locally** → the agent keypair has no SOL
  for fees; airdrop to it.
- **Threads disappear on Vercel** → expected with `fs`; use Neon + `postgres`.
- **Program deploy fails** → ensure the deploy wallet has SOL and `anchor keys
  sync` was run so `declare_id!` matches your program keypair.
