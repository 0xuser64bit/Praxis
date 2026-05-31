# Praxis environment variables

A practical map of `.env`: what **you must supply**, what is **auto-generated**
(already filled, or produced by a command), and what has a **safe default** you
can leave alone. Full inline docs live in `.env.example`.

> TL;DR for a production deploy you only have to hand-enter a handful of values:
> `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SITE_URL`, `DATABASE_URL`, and (for live
> custody) the Oracle signer trio. Everything else is generated or defaulted.

---

## 1. You must provide these

| Variable | Where to get it | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys | Required for intent parsing. The only hard secret with no fallback. |
| `NEXT_PUBLIC_SITE_URL` | Your production domain | e.g. `https://praxis.yourdomain.com`. Drives absolute OG/Twitter share-image URLs. Defaults to `http://localhost:3000` locally. |
| `DATABASE_URL` | Neon (Vercel Marketplace) or any Postgres | Required for **durable** prod state (threads/proposals survive across serverless instances). Without it, state falls back to the filesystem — fine for local/devnet only. |
| `AEGIS_OWNER_ADDRESS` | Your wallet public key | Optional. Used by bootstrap scripts; route auth comes from the wallet session, not this. |
| `SOLANA_RPC_URL` | Helius / Triton / QuickNode for prod | Defaults to public devnet (`https://api.devnet.solana.com`). Public RPC is rate-limited — use a paid endpoint for production traffic. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash (Vercel Marketplace) | Optional. Only needed for cross-instance rate limiting. Omit → in-memory limiter (fine for a single instance). |

## 2. Auto-generated (filled for you, or one command away)

| Variable | Status | Regenerate with |
|---|---|---|
| `PRAXIS_SESSION_SECRET` | ✅ already filled | `openssl rand -base64 32` |
| `PRAXIS_AGENT_SIGNER_TOKEN` | ✅ already filled | `openssl rand -base64 32` — must match `SIGNER_TOKEN` on the Oracle VM |
| Agent keypair (`keys/agent.json`) | ✅ exists (devnet pubkey `6eW2A3HstwT5869MfUTqXCEMjrkjwLtANQRMxSmrSg4Y`) | `solana-keygen new -o keys/agent.json` (the Oracle setup script does this for prod) |
| `PRAXIS_AGENT_PUBLIC_KEY` | derived | The Oracle setup script prints it; or `solana-keygen pubkey keys/agent.json` |

These are secrets — they are intentionally **not** committed (`keys/` and `.env`
are gitignored). On Vercel, set them via `vercel env add` or the dashboard.

## 3. Safe defaults — leave alone unless you have a reason

| Variable | Default | When you'd change it |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Newer model rollout |
| `SOLANA_COMMITMENT` | `confirmed` | Rarely |
| `AEGIS_PROGRAM_ID` | deployed Aegis program | Only if you redeploy the program |
| `NEXT_PUBLIC_PRAXIS_PROVIDER` | `api` | Keep `api` for real deploys; `mock` is local-only |
| `NEXT_PUBLIC_PRAXIS_ALLOW_MOCK` | `0` | Keep `0` in prod |
| `PRAXIS_STATE_BACKEND` | auto (`postgres` if `DATABASE_URL` set, else `fs`) | Force a backend |
| `PRAXIS_STATE_DIR` | `.praxis/state` | Local fs state location |
| `PRAXIS_LLM_TIMEOUT_MS` / `RPC` / `INDEXER` | bounded timeouts | Tune for your RPC |
| `PRAXIS_LOG_LEVEL` | `info` in prod, `debug` otherwise | Debugging |
| `PRAXIS_RATE_LIMITER` | auto (redis if Upstash set, else memory) | Force a backend |
| `PRAXIS_ADDRESS_BOOK` | empty | Add your own saved contacts (no seeded demo data ships) |
| `PRAXIS_ALLOW_DEMO_DATA` | `0` | `1` (non-prod only) to surface built-in demo contacts |
| `PRAXIS_LOCAL_INTENT` | `1` locally | Deterministic parser for demos without an API key |
| `PRAXIS_INDEXER_URL` | DexScreener | Swap in another indexer |

## 4. Production agent-key custody (Oracle VM)

For a live deploy you do **not** want the agent private key sitting in Vercel
env. Move signing behind the standalone signer service on an Oracle Cloud
Always-Free VM (see [`ORACLE_VM.md`](./ORACLE_VM.md)). Then set on Vercel:

| Variable | Value |
|---|---|
| `PRAXIS_AGENT_SIGNER_URL` | `https://<your-tunnel-host>/sign` |
| `PRAXIS_AGENT_PUBLIC_KEY` | agent pubkey (not secret — printed by the setup script) |
| `PRAXIS_AGENT_SIGNER_TOKEN` | same value as `SIGNER_TOKEN` on the VM |
| `PRAXIS_ALLOW_LOCAL_AGENT_KEY` | leave unset → a raw in-process key is refused in prod |

With the signer in place, omit `PRAXIS_AGENT_KEYPAIR` / `PRAXIS_AGENT_KEYPAIR_PATH`
from the Vercel environment entirely — the private key lives only on the VM.
