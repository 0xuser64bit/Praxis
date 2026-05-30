# Praxis — $0 devnet "go live" runbook

Get Praxis running for judges and a handful of testers (≈1–10 users, ≤100 best
case) for **$0**. Everything below uses free tiers and devnet faucet SOL.

There are two paths. Pick based on what you want to show:

| Path | What it shows | Setup | Best for |
|---|---|---|---|
| **A. Mock on Vercel** | The full product walkthrough (all five money-shots) with no chain, no keys | ~5 min, 1 env var | **Judges self-serve.** Zero friction. |
| **B. Live API on devnet** | Real Aegis enforcement on a real cluster | ~30 min | You demoing the real on-chain moat. |

You can deploy **both** (two Vercel projects, or one project you reconfigure).
Mock is the safe always-works demo; Live API is the proof it's real.

---

## Path A — Mock mode on Vercel (fastest $0)

The mock provider runs entirely in the browser. No RPC, no keypairs, no
Anthropic, no database. The five §9 money-shots are all walkable.

1. Push this repo to GitHub (if it isn't already).
2. On [vercel.com](https://vercel.com) → **Add New → Project** → import the repo.
   Framework auto-detects as Next.js; the build command is `next build`.
3. Add **one** Environment Variable:
   - `NEXT_PUBLIC_PRAXIS_PROVIDER` = `mock`
4. Deploy. Open `https://<your-app>.vercel.app/app`.

That's it. **$0**, no secrets, resets cleanly on every load. Use Vercel Hobby
(free, non-commercial — fine for a hackathon/demo).

---

## Path B — Live API mode on devnet ($0, real on-chain)

This runs the real `agent_transfer` flow through the deployed Aegis program on
Solana **devnet** (free faucet SOL). The signed-in wallet is the policy owner.

> **Single-owner caveat:** the policy PDA is derived from the signed-in wallet,
> and there is no self-serve "initialize policy" UI yet (init is a script step
> using a backend owner key). So the clean way to demo Live API is: **you**
> bootstrap one owner wallet and sign in as that owner. Judges get the full
> self-serve experience on **Path A (mock)**; you show Path B yourself.

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

### 2. Create and fund the owner + agent keypairs

```bash
mkdir -p keys
solana-keygen new --no-bip39-passphrase -o keys/owner.json
solana-keygen new --no-bip39-passphrase -o keys/agent.json
# Optional, only if you'll demo rotate:
solana-keygen new --no-bip39-passphrase -o keys/next-agent.json

solana airdrop 2 $(solana-keygen pubkey keys/owner.json) --url devnet
solana airdrop 2 $(solana-keygen pubkey keys/agent.json)  --url devnet
```

The **owner** pays for policy init + vault funding; the **agent** is the fee
payer for `agent_transfer`, so both need a little devnet SOL. (`keys/` is
git-ignored — never commit keypairs.)

### 3. Configure `.env` and bootstrap the policy

```bash
cp .env.example .env
```

Set in `.env` (everything else can stay default):

```bash
NEXT_PUBLIC_PRAXIS_PROVIDER=api
SOLANA_RPC_URL=https://api.devnet.solana.com
AEGIS_PROGRAM_ID=<your program id from step 1>
PRAXIS_OWNER_KEYPAIR_PATH=./keys/owner.json
PRAXIS_AGENT_KEYPAIR_PATH=./keys/agent.json
PRAXIS_NEXT_AGENT_KEYPAIR_PATH=./keys/next-agent.json   # only if demoing rotate
PRAXIS_LOCAL_INTENT=1                                    # $0 — no Anthropic key needed
PRAXIS_SESSION_SECRET=<run: openssl rand -base64 32>
PRAXIS_STATE_BACKEND=fs                                  # local; see persistence note below
```

Bootstrap the on-chain policy (initializes the policy, funds the vault with 1
SOL, configures the USDC envelope, and prepares token accounts):

```bash
bun run praxis:demo
# For SPL sends, also:  bun run praxis:setup-token-accounts
```

`praxis:demo` is idempotent — if the policy already exists it just runs the
allow/over-cap money-shots.

### 4. Verify locally

```bash
bun run dev
```

Open `http://localhost:3000/app`, connect Phantom (**set to devnet**, using the
**owner** wallet so its address matches the initialized policy), and try
`send 0.5 sol to maya`.

### 5. Deploy Live API to Vercel

Import the repo on Vercel (as in Path A) and set these Environment Variables.
**Keys go in as values, not file paths** — Vercel has no writable key files:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_PRAXIS_PROVIDER` | `api` |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` (or a free Helius/QuickNode devnet URL) |
| `AEGIS_PROGRAM_ID` | your program id |
| `PRAXIS_SESSION_SECRET` | a random 32+ char string |
| `PRAXIS_AGENT_KEYPAIR` | the **contents** of `keys/agent.json` (the JSON array) |
| `PRAXIS_OWNER_KEYPAIR` | the contents of `keys/owner.json` |
| `PRAXIS_LOCAL_INTENT` | `1` |
| `PRAXIS_STATE_BACKEND` | `fs` (ephemeral on Vercel) or `postgres` + `DATABASE_URL` (Neon free) |

Deploy, open `/app`, connect the **owner** wallet on devnet.

> On Vercel, `fs` state is per-instance and ephemeral — threads/proposals reset
> between cold starts. Fine for a quick demo; for persistence add a free **Neon**
> database (Vercel Marketplace) and set `PRAXIS_STATE_BACKEND=postgres` +
> `DATABASE_URL` (the schema self-creates). Still $0.

---

## Cost summary

| Component | Free option | Cost |
|---|---|---|
| App hosting | Vercel Hobby + `*.vercel.app` | $0 |
| Cluster | Solana **devnet** + faucet SOL | $0 |
| RPC | devnet public, or Helius/QuickNode free tier | $0 |
| Intent parsing | `PRAXIS_LOCAL_INTENT=1` | $0 |
| State | `fs`, or Neon free tier | $0 |
| Rate limiting | in-memory default | $0 |
| Agent signing | `LocalKeypairSigner` default | $0 |

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

- **"Aegis policy account not found"** → run `bun run praxis:demo` (the policy
  isn't initialized for that owner), and make sure the wallet you sign in with
  matches the owner that initialized it.
- **Sign-in fails / no wallet** → Phantom must be installed and switched to
  **devnet**.
- **`PRAXIS_SESSION_SECRET is required in production`** → set it in Vercel env.
- **Transfers "fail before confirmation" locally** → the agent keypair has no
  devnet SOL for fees; airdrop to it.
- **Threads disappear on Vercel** → expected with `fs`; use Neon (above).
- **Program deploy fails** → ensure your deploy wallet has SOL
  (`solana airdrop 2`) and `anchor keys sync` was run so `declare_id!` matches
  your program keypair.
