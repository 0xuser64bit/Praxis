# Praxis agent signer service

[Home](../README.md) · [Deployment](../docs/DEPLOY.md#production-agent-key-custody) · [Trust boundaries](../docs/ARCHITECTURE.md#trust-boundaries)

A tiny standalone signer that holds the Aegis **agent** key behind a network
boundary. The Praxis app (`HttpRemoteAgentSigner`) posts a transaction message;
this service signs it **only** if it is a single Aegis `agent_transfer` /
`agent_transfer_spl` to the configured program, and returns the signature. The
agent private key never leaves this process.

This is the production custody path. Local/devnet can skip it entirely and use
the in-process `LocalKeypairSigner` (the default).

## Run

Install root dependencies with `bun install --frozen-lockfile`. Run from the
repository root with a dedicated **agent** key, never an owner key. For local
testing, the key can be the one created in the [devnet setup](../docs/DEPLOY.md#local-api-mode-on-devnet).
Set `SIGNER_TOKEN` securely in the environment first, using a random shared
secret (for example, one generated with `openssl rand -base64 32`).

```bash
SIGNER_AGENT_KEYPAIR_PATH=./keys/agent.json \
bun run signer
```

In another terminal, `curl --fail http://localhost:8787/` returns
`{"ok":true,"agent":"<public-key>"}`. It is an unauthenticated liveness/public
key endpoint, not a chain-readiness check. Match its public key against the
app configuration and on-chain policy authority. The key needs fee SOL.

Env:

- `SIGNER_TOKEN` (required) — bearer token the app must present.
- `SIGNER_AGENT_KEYPAIR` or `SIGNER_AGENT_KEYPAIR_PATH` (required) — the agent
  secret key (JSON array or base58), or a path to it.
- `SIGNER_AEGIS_PROGRAM_ID` (optional) — defaults to the repo's Aegis program id
  (`server/aegis/constants.ts`); set it if you deployed your own.
- `SIGNER_PORT` (optional) — defaults to `8787`.
- `SIGNER_MAX_SIGNATURES_PER_MINUTE` (optional) — defaults to `60`.

Authenticated signing requests have an 8 KiB body limit, enforced while reading
the stream even without `Content-Length`. Oversized bodies are cancelled before
JSON parsing; the signature rate limit does not substitute for this input bound.

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

Malformed or oversized JSON bodies return `400`. The service handles legacy
serialized transaction messages; it is not a general versioned-transaction,
arbitrary-CPI, owner-transaction, or wallet-message signing API. It signs bytes
and returns a signature; the app assembles and submits the transaction.

**Audit.** Authentication refusals, policy refusals, rate-limit hits, and
successful signatures are structured-log events. Signature events include
the instruction, policy PDA, and amount; malformed-body responses are not
currently logged by the handler.
These logs are the request record for this custody path, not proof that an
extracted key was never used elsewhere. Ship them somewhere durable so you can
investigate what was signed while a bearer token was exposed.

## Deploy

`scripts/oracle-vm-setup.sh` provisions the signer on an Oracle Cloud
VM behind a Cloudflare Tunnel (systemd unit, generated key and
token) and prints the `PRAXIS_AGENT_SIGNER_*` values for the app. Review it
before use: it installs software, writes system configuration, and prints
sensitive values. Cloud availability and costs are not guaranteed. See
[docs/DEPLOY.md](../docs/DEPLOY.md#production-agent-key-custody). The service
imports from `server/`, so deploy it from a full checkout.

Configure the app with `PRAXIS_AGENT_SIGNER_URL` ending in `/sign`,
`PRAXIS_AGENT_PUBLIC_KEY`, and the matching `PRAXIS_AGENT_SIGNER_TOKEN`.
For a custom program, set `SIGNER_AEGIS_PROGRAM_ID` to the same ID as the app.
Keep the private key only on the signer host and remove local-agent keys from
the app environment.

## Security and operations

- Use authenticated, encrypted transport and restrict who can reach `/sign`.
  The bearer token is a spending credential, even though it is not the raw key.
- A compromised app/token can request recognized agent transfers within every
  policy that registers this key. The signer does not check user sessions or
  provide per-owner isolation; Aegis applies the actual policy on-chain.
- The signature rate limit is per process and fixed-window; replicas multiply
  its capacity. Body-size limits do not bound all unauthenticated ingress load.
- Preserve custody-key backups securely. For rotation, coordinate the new
  on-chain authority with the key the service can sign with; keep both funded
  for their respective transition windows.
- Alert on unexpected signature volume, refusals, and fee-balance depletion.
  Never put bearer tokens or private keys in audit output.

## Further hardening

The service is intentionally minimal. To raise the bar without changing the app
or wire contract, rework its internals to delegate signing to a real KMS/HSM
(e.g. GCP Cloud KMS `EC_SIGN_ED25519`), add IP allow-listing or mTLS, and make
the rate limit and audit log per-policy rather than per-process.
