# Praxis agent signer service

A tiny standalone signer that holds the Aegis **agent** key behind a network
boundary. The Praxis app (`HttpRemoteAgentSigner`) posts a transaction message;
this service signs it **only** if it is a single Aegis `agent_transfer` /
`agent_transfer_spl` to the configured program, and returns the signature. The
agent private key never leaves this process.

This is the production custody path. Local/devnet can skip it entirely and use
the in-process `LocalKeypairSigner` (the default).

## Run

```bash
SIGNER_TOKEN=<long-random-shared-secret> \
SIGNER_AGENT_KEYPAIR_PATH=./keys/agent.json \
SIGNER_AEGIS_PROGRAM_ID=7qRKV1dNPCixKWDLHsuHa5puFsNPtNCzC1sX6P1kpFgb \
SIGNER_PORT=8787 \
bun run signer
```

Env:

- `SIGNER_TOKEN` (required) — bearer token the app must present.
- `SIGNER_AGENT_KEYPAIR` or `SIGNER_AGENT_KEYPAIR_PATH` (required) — the agent
  secret key (JSON array or base58), or a path to it.
- `SIGNER_AEGIS_PROGRAM_ID` (optional) — defaults to the Aegis program id.
- `SIGNER_PORT` (optional) — defaults to `8787`.

## Wire contract

```
POST /sign
Authorization: Bearer <SIGNER_TOKEN>
{ "message": "<base64 tx message>" }  ->  200 { "signature": "<base64>" }
GET  /                                ->  200 { "ok": true, "agent": "<pubkey>" }
```

It refuses (`401`) without the token and (`403`) anything that is not a single
Aegis agent transfer. The on-chain program remains the authoritative enforcement;
this is defense in depth at the key boundary.

## Deploy for ~$0 (Oracle Cloud Always Free + Cloudflare Tunnel)

1. Create an **Oracle Cloud Always Free** VM (ARM Ampere is generous and free
   forever). Install Bun, copy this repo (or just `signer/` + `server/`), and run
   the service bound to `127.0.0.1:8787`.
2. Expose it over HTTPS with a **Cloudflare Tunnel** (free TLS, no open inbound
   ports or static IP):
   ```bash
   cloudflared tunnel --url http://127.0.0.1:8787
   ```
   (or a named tunnel mapped to a subdomain you control).
3. On the Praxis app (Vercel), set:
   - `PRAXIS_AGENT_SIGNER_URL=https://<your-tunnel-host>/sign`
   - `PRAXIS_AGENT_PUBLIC_KEY=<agent pubkey>` (not secret)
   - `PRAXIS_AGENT_SIGNER_TOKEN=<same SIGNER_TOKEN>`
   - leave `PRAXIS_ALLOW_LOCAL_AGENT_KEY` unset so a raw in-process key is refused.

The agent private key now lives only on the VM; the Vercel app holds just the
agent public key and the bearer token. Run the VM process under a supervisor
(`systemd`, `pm2`, or `tmux`) so it restarts on reboot.

## Hardening later

The service is intentionally minimal and stateless. To raise the bar without
changing the app or wire contract, rework its internals to delegate signing to a
real KMS/HSM (e.g. GCP Cloud KMS `EC_SIGN_ED25519`), add IP allow-listing or
mTLS, and add per-key rate limits.
