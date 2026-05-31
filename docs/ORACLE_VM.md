# Oracle VM — Praxis agent signer

## Why there's a VM at all (the co-founder question)

The app runs on **Vercel**. So what is Oracle for?

One thing, and only one thing: **custody of the Aegis agent private key.**

Praxis signs `agent_transfer` instructions with a scoped *agent* key. That key
is the most sensitive secret in the system. Putting it in Vercel's environment
means it sits in a multi-tenant serverless platform's env store and is readable
by any function invocation. We don't want that.

Instead, the key lives on a tiny always-on box behind a network boundary — the
standalone **signer service** (`signer/`). It accepts a transaction message,
signs it *only* if it's a single Aegis agent transfer to the right program, and
returns the signature. The private key never leaves the VM.

```
  Browser ──▶ Vercel (Next.js app)  ──HTTPS──▶  Oracle VM
              holds: agent PUBLIC key            holds: agent PRIVATE key
                     + bearer token                     (signer service)
                                                 exposed via Cloudflare Tunnel
```

Oracle Cloud's **Always-Free ARM (Ampere) VM** is free forever and more than
enough. Cloudflare Tunnel gives free HTTPS with no open inbound ports.

This is defense-in-depth — the on-chain Aegis program is still the authoritative
enforcement. The signer just makes the key impossible to exfiltrate from Vercel.

## One-shot setup

On a fresh Oracle Always-Free VM (Ubuntu 22.04+ ARM recommended):

```bash
# 1. SSH in
ssh ubuntu@<your-vm-ip>

# 2. Get the code (full repo — the signer imports server/ and node_modules)
git clone <your-repo-url> praxis && cd praxis

# 3. (optional) run Claude Code here, or just run the script directly:
bash scripts/oracle-vm-setup.sh
```

The script is **idempotent** and does everything:

1. Installs base packages + **Bun**.
2. `bun install`.
3. Generates a fresh **agent keypair** (`keys/agent.json`) if none exists.
4. Generates a **bearer token** if none exists.
5. Installs a **systemd service** (`praxis-signer`) so the signer runs on boot
   and restarts on crash.
6. Installs **cloudflared** and sets up a tunnel.
7. Prints the exact **Vercel env vars** to paste back.

### Tunnel: quick vs named

- **No token (default):** a *quick tunnel* starts with an ephemeral
  `*.trycloudflare.com` URL. Great for a first test — but the URL **changes on
  every restart**, so it's not suitable for production.
- **Production (recommended):** create a **named tunnel** in the Cloudflare
  Zero Trust dashboard, copy its connector **token**, and run:

  ```bash
  CLOUDFLARE_TUNNEL_TOKEN=<token> bash scripts/oracle-vm-setup.sh
  ```

  Then, in the dashboard, route your chosen hostname (e.g.
  `signer.yourdomain.com`) to `http://localhost:8787`. That hostname is stable.

## Wire it to Vercel

The script prints these — set them on your Vercel project (Production scope):

```
PRAXIS_AGENT_SIGNER_URL=https://<your-tunnel-host>/sign
PRAXIS_AGENT_PUBLIC_KEY=<agent pubkey, printed by the script — not secret>
PRAXIS_AGENT_SIGNER_TOKEN=<same value as SIGNER_TOKEN on the VM>
```

Then on Vercel:

- **Remove** `PRAXIS_AGENT_KEYPAIR` / `PRAXIS_AGENT_KEYPAIR_PATH` — the app no
  longer needs a private key.
- Leave `PRAXIS_ALLOW_LOCAL_AGENT_KEY` **unset** — in production the backend
  refuses a raw in-process agent key, forcing the remote-signer path.

Fund the agent address (`PRAXIS_AGENT_PUBLIC_KEY`) with a little SOL for fees on
whichever cluster you're targeting.

## Operating it

```bash
sudo systemctl status praxis-signer      # health
sudo journalctl -u praxis-signer -f      # live logs
sudo systemctl restart praxis-signer     # restart
curl -s http://127.0.0.1:8787/           # { ok, agent } health probe
```

Rotating the agent key later: generate a new keypair, point Aegis at the new
authority via the rotate-agent flow, update `keys/agent.json` on the VM, and
`sudo systemctl restart praxis-signer`.

## Hardening later

The signer is intentionally minimal and stateless. To raise the bar without
touching the app or wire contract: delegate signing to a KMS/HSM (e.g. GCP Cloud
KMS `EC_SIGN_ED25519`), add IP allow-listing or mTLS at the tunnel, and add
per-key rate limits. See `signer/README.md`.
