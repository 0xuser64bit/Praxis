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
bun run signer
```

Env:

- `SIGNER_TOKEN` (required) — bearer token the app must present.
- `SIGNER_AGENT_KEYPAIR` or `SIGNER_AGENT_KEYPAIR_PATH` (required) — the agent
  secret key (JSON array or base58), or a path to it.
- `SIGNER_AEGIS_PROGRAM_ID` (optional) — defaults to the repo's Aegis program id
  (`server/aegis/constants.ts`); set it if you deployed your own.
- `SIGNER_PORT` (optional) — defaults to `8787`.
- `SIGNER_MAX_SIGNATURES_PER_MINUTE` (optional) — defaults to `60`.

## Wire contract

```
POST /sign
Authorization: Bearer <SIGNER_TOKEN>
{ "message": "<base64 tx message>" }  ->  200 { "signature": "<base64>" }
GET  /                                ->  200 { "ok": true, "agent": "<pubkey>" }
```

It refuses (`401`) without the token, (`403`) anything that is not a single
Aegis agent transfer, and (`429`) past its per-minute signature ceiling. The
on-chain program remains the authoritative enforcement; this is defense in
depth at the key boundary.

**Audit.** Every outcome is logged as one JSON line — refusals, rate-limit
hits, and each signature with the instruction, the policy PDA and the amount.
This process is the only component that observes every use of the agent key,
so "what did the agent sign while the token was leaked" is answerable only
from here. Ship these lines somewhere durable.

## Deploy

`scripts/oracle-vm-setup.sh` provisions the signer on an Oracle Cloud
Always-Free VM behind a Cloudflare Tunnel (systemd unit, generated key and
token) and prints the `PRAXIS_AGENT_SIGNER_*` values for the app. See
[docs/DEPLOY.md](../docs/DEPLOY.md#production-agent-key-custody). The service
imports from `server/`, so deploy it from a full checkout.

## Hardening later

The service is intentionally minimal. To raise the bar without changing the app
or wire contract, rework its internals to delegate signing to a real KMS/HSM
(e.g. GCP Cloud KMS `EC_SIGN_ED25519`), add IP allow-listing or mTLS, and make
the rate limit and audit log per-policy rather than per-process.
