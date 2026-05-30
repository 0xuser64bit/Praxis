# Praxis — $0 devnet "go live" runbook

Get Praxis running for a handful of testers (≈1–10 users, ≤100 best case) for
**$0**. Everything below uses free tiers and devnet faucet SOL.

There are two paths, but only one deploy path:

| Path | What it shows | Setup | Best for |
|---|---|---|---|
| **A. Local mock smoke test** | UI and policy-preview ergonomics with no chain, no keys | ~2 min, local only | Fast development checks |
| **B. Live API on devnet** | Real Aegis enforcement on a real cluster | ~30 min | Shared tester/demo deployment |

Production builds default to API mode. Mock mode is deliberately local/dev-only
unless `NEXT_PUBLIC_PRAXIS_ALLOW_MOCK=1` is set at build time.

---

## Path A — Local mock smoke test

The mock provider runs entirely in the browser. No RPC, no keypairs, no
Anthropic, no database. Use it to verify UI flows before wiring live chain state.

```bash
NEXT_PUBLIC_PRAXIS_PROVIDER=mock bun run dev
```

Open `http://localhost:3000/app`.

---

## Path B — Live API mode on devnet ($0, real on-chain)

This runs the real `agent_transfer` flow through the deployed Aegis program on
Solana **devnet** (free faucet SOL). The signed-in wallet is the policy owner,
and first-run policy initialization is wallet-signed from `/app`.

### 0. Prerequisites (all free)

- [Bun](https://bun.sh), the [Solana CLI](https://docs.solana.com/cli/install),
  and [Anchor](https://www.anchor-lang.com/docs/installation)
  (this repo pins `anchor 1.0.1`, `solana 3.1.15` in `aegis/Anchor.toml`).
- A browser wallet (Phantom) you can switch to **devnet**.

```bash
solana config set --url https://api.devnet.solana.com
```

### 1. Deploy the Aegis program to devnet

```bash
cd aegis
anchor build
# Align the on-chain program id with the keypair anchor generated, then rebuild:
anchor keys sync          # updates declare_id! in lib.rs to your program keypair
anchor build
solana airdrop 2          # fund your deploy wallet (~/.config/solana/id.json)
anchor deploy --provider.cluster devnet
anchor keys list          # note the program id you just deployed
cd ..
```

Use that program id as `AEGIS_PROGRAM_ID` below. (If you already hold the keypair
for `7qRKV1dNPCixKWDLHsuHa5puFsNPtNCzC1sX6P1kpFgb`, you can skip `keys sync` and
keep that id.)

### 2. Create and fund the agent keypair

```bash
mkdir -p keys
solana-keygen new --no-bip39-passphrase -o keys/agent.json
# Optional, only if you'll demo rotate:
solana-keygen new --no-bip39-passphrase -o keys/next-agent.json

solana airdrop 2 $(solana-keygen pubkey keys/agent.json)  --url devnet
```

The connected browser wallet pays for policy init + vault funding; the
**agent** is the fee payer for `agent_transfer`, so both need devnet SOL. Airdrop
at least 2 SOL to the browser wallet in Phantom/Solflare devnet before first
launch. (`keys/` is git-ignored — never commit keypairs.)

### 3. Configure `.env`

```bash
cp .env.example .env
```

Set in `.env` (everything else can stay default):

```bash
NEXT_PUBLIC_PRAXIS_PROVIDER=api
SOLANA_RPC_URL=https://api.devnet.solana.com
AEGIS_PROGRAM_ID=<your program id from step 1>
PRAXIS_AGENT_KEYPAIR_PATH=./keys/agent.json
PRAXIS_NEXT_AGENT_KEYPAIR_PATH=./keys/next-agent.json   # only if demoing rotate
PRAXIS_LOCAL_INTENT=1                                    # $0 — no Anthropic key needed
PRAXIS_SESSION_SECRET=<run: openssl rand -base64 32>
PRAXIS_STATE_BACKEND=fs                                  # local; see persistence note below
```

### 4. Verify locally

```bash
bun run dev
```

Open `http://localhost:3000/app`, connect a wallet on **devnet**, and click
**Initialize devnet policy** if prompted. The wallet signs a transaction that
creates its Aegis policy PDA and funds the vault with 1 SOL. Then try
`send 0.5 sol to maya`.

For scripted local/devnet demos, you can still configure
`PRAXIS_OWNER_KEYPAIR_PATH=./keys/owner.json`, airdrop to that owner, and run:

```bash
solana-keygen new --no-bip39-passphrase -o keys/owner.json
solana airdrop 2 $(solana-keygen pubkey keys/owner.json) --url devnet
bun run praxis:demo
# For SPL sends, also:  bun run praxis:setup-token-accounts
```

### 5. Deploy Live API to Vercel

Import the repo on Vercel and set these Environment Variables.
**Keys go in as values, not file paths** — Vercel has no writable key files:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_PRAXIS_PROVIDER` | `api` |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` (or a free Helius/QuickNode devnet URL) |
| `AEGIS_PROGRAM_ID` | your program id |
| `PRAXIS_SESSION_SECRET` | a random 32+ char string |
| `PRAXIS_AGENT_KEYPAIR` | the **contents** of `keys/agent.json` (the JSON array) |
| `PRAXIS_ALLOW_LOCAL_AGENT_KEY` | `1` for devnet judging only; use the remote signer for real production |
| `PRAXIS_OWNER_KEYPAIR` | local/devnet fallback only; omit for judge/self-serve wallet bootstrap |
| `PRAXIS_LOCAL_INTENT` | `1` |
| `PRAXIS_STATE_BACKEND` | `postgres` |
| `DATABASE_URL` | Neon or another Postgres-compatible URL |
| `PRAXIS_ADDRESS_BOOK` | `[{"label":"maya","name":"Maya Patel","address":"ALUMw7kSn9xn67suHr2ti21CXBQVNMuRk7uWSM1WuXEt","note":"saved contact"}]` |

Deploy, open `/app`, connect a devnet-funded wallet, and initialize the policy
from the prompt.

> On Vercel, `fs` state is per-instance and ephemeral. Use a free **Neon**
> database (Vercel Marketplace) and set `PRAXIS_STATE_BACKEND=postgres` +
> `DATABASE_URL`; the schema self-creates.

---

## Cost summary

| Component | Free option | Cost |
|---|---|---|
| App hosting | Vercel Hobby + `*.vercel.app` | $0 |
| Cluster | Solana **devnet** + faucet SOL | $0 |
| RPC | devnet public, or Helius/QuickNode free tier | $0 |
| Intent parsing | `PRAXIS_LOCAL_INTENT=1` | $0 |
| State | Neon free tier | $0 |
| Rate limiting | Upstash Redis free tier, or in-memory for tiny single-instance tests | $0 |
| Agent signing | Remote signer free VM, or local key only for devnet tests | $0 |

**Total: $0.** The only things that ever cost money are optional: real Claude
intent parsing (pennies), or running on **mainnet** (a few dollars of real SOL
for vault/rent + ~$0.0005/tx). For judging, devnet is standard and free.

---

## Optional production upgrades (still $0 on free tiers)

These are all env toggles — flip them when you want, no code changes:

- **Durable state:** Neon Postgres free tier → `PRAXIS_STATE_BACKEND=postgres`,
  `DATABASE_URL=...`.
- **Cross-instance rate limits:** Upstash Redis free tier →
  `PRAXIS_RATE_LIMITER=redis`, `UPSTASH_REDIS_REST_URL/_TOKEN`.
- **Agent-key custody:** run the signer service (`signer/`) on an **Oracle Cloud
  Always-Free** VM behind a Cloudflare Tunnel, then set `PRAXIS_AGENT_SIGNER_URL`
  / `PRAXIS_AGENT_PUBLIC_KEY` / `PRAXIS_AGENT_SIGNER_TOKEN` so the agent key never
  lives in the Vercel app. See `signer/README.md`.
- **Real LLM parsing:** set `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL` and remove
  `PRAXIS_LOCAL_INTENT`.

---

## Troubleshooting

- **"Aegis policy account not found"** → click **Initialize devnet policy** from
  `/app`. If the wallet prompt never appears, confirm the wallet supports
  transaction signing and is connected to **devnet**.
- **Sign-in fails / no wallet** → Phantom must be installed and switched to
  **devnet**.
- **`PRAXIS_SESSION_SECRET is required in production`** → set it in Vercel env.
- **Transfers "fail before confirmation" locally** → the agent keypair has no
  devnet SOL for fees; airdrop to it.
- **Threads disappear on Vercel** → expected with `fs`; use Neon (above).
- **Program deploy fails** → ensure your deploy wallet has SOL
  (`solana airdrop 2`) and `anchor keys sync` was run so `declare_id!` matches
  your program keypair.
