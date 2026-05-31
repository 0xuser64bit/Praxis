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
