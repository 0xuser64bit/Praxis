# Agent-key custody via an `AgentSigner` seam

**Date:** 2026-05-30
**Status:** Approved (design)
**Branch:** `feat/agent-key-custody`

## Problem

The Aegis agent session key — the scoped key that signs `agent_transfer` /
`agent_transfer_spl` — is currently loaded as a raw ed25519 keypair from an env
var or file (`PRAXIS_AGENT_KEYPAIR` / `PRAXIS_AGENT_KEYPAIR_PATH`) and signs
in-process via `tx.sign(agent)`. This is the last real production custody gap:
the private key lives in the application's memory and environment. Production
wants the private key behind a key-management boundary the app cannot read.

## Goal

Move agent **signing** behind a swappable `AgentSigner` boundary so production
custody can hold the private key in an external signer service (which itself may
wrap GCP KMS, an HSM, or Turnkey), while local/devnet keeps the existing
in-process keypair. The seam is vendor-neutral; the first concrete remote
implementation is a generic HTTP signer.

Non-goals: changing the on-chain program; changing the single-shared-agent-key
model; moving owner/token-setup signing (already handled / out of scope).

## Current state (grounding)

The agent key is used in two ways in `server/aegis/client.ts`:

- **Signing (must move):** `tx.sign(agent)` at four sites —
  `simulateAgentTransfer`, `executeAgentTransfer`, `simulateAgentTransferSpl`,
  `executeAgentTransferSpl`.
- **Public key only (may stay):** building instructions (fee payer +
  `agentAuthority`), `addresses()`, `initializePolicy`'s `agentAuthority` arg,
  and `rotate_agent`'s equality check.

Loaded via `requireAgentKeypair(config)` from `server/env.ts`
(`config.agentKeypair`). Also referenced by `scripts/praxis-demo.ts`.

## Design

### Interface

```ts
// server/agent/agentSigner.ts
export interface AgentSigner {
  readonly publicKey: PublicKey;
  /** Add the agent's signature to a built transaction and return it. */
  signTransaction(tx: Transaction): Promise<Transaction>;
}
```

### Implementations

1. **`LocalKeypairSigner`** — wraps the existing `Keypair`; `signTransaction`
   calls native `tx.sign(keypair)`. Default for local/devnet. Zero behavior
   change vs. today.

2. **`HttpRemoteAgentSigner`** — holds **no** private key. `signTransaction`:
   - `const message = tx.serializeMessage();`
   - POST the message to the signer service, receive a 64-byte ed25519 signature;
   - `tx.addSignature(this.publicKey, signature)` (web3 verifies the signature
     against the message, so a wrong/garbage signature throws immediately).

   Uses `fetchWithTimeout`. **Fails closed**: any signing error throws and the
   action is rejected — it never falls back to a local key.

### Remote signer contract (the service is out-of-repo)

```
POST {PRAXIS_AGENT_SIGNER_URL}
Authorization: Bearer {PRAXIS_AGENT_SIGNER_TOKEN}
Content-Type: application/json
{ "message": "<base64 tx message>", "programId": "<aegis program id>", "walletAddress": "<owner>" }

200 -> { "signature": "<base64 64-byte ed25519 signature>" }
```

`programId` and `walletAddress` are sent as **context** so the signer service
can enforce its own policy (e.g. only sign `agent_transfer` /
`agent_transfer_spl` to the Aegis program). Enforcement lives in the service;
this repo documents the recommended policy but does not implement the service.

### Resolution & configuration

A factory `getAgentSigner(config)` (and `requireAgentSigner`) resolves:

- If `PRAXIS_AGENT_SIGNER_URL` is set → `HttpRemoteAgentSigner`, requiring:
  - `PRAXIS_AGENT_PUBLIC_KEY` (the agent address; not secret), and
  - `PRAXIS_AGENT_SIGNER_TOKEN` (bearer auth to the signer service).
- Else if an agent keypair is configured → `LocalKeypairSigner`.
- Else → `requireAgentSigner` throws a `PraxisConfigError`.

**Production guard:** when `NODE_ENV=production`, refuse a raw env/file agent
keypair unless `PRAXIS_ALLOW_LOCAL_AGENT_KEY=1` is explicitly set. This makes the
custody boundary the default in production while keeping local/devnet frictionless.

`PraxisServerConfig` gains `agentSigner?: AgentSigner` (resolved once, like
`agentKeypair` is today). `AegisClient` accepts it (injectable for tests, like
`conn`). The four sign sites become `await this.agentSigner.signTransaction(tx)`;
`agent.publicKey` reads become `this.agentSigner.publicKey`;
`requireAgentKeypair` usage in `AegisClient` is replaced by the signer.

### Simulation (execute-only signing)

Today both simulate and execute sign. With a remote signer, signing every
preview means a signer round-trip per "what would happen," adding latency/cost.

**Decision (approved):** sign on **execute only**. For simulation, send the
unsigned transaction with `simulateTransaction(tx, { sigVerify: false })` (a
valid agent signature is not required to simulate). During implementation, verify
web3.js accepts an unsigned legacy transaction for simulation; if it does not,
fall back to signing-on-simulate through the same `AgentSigner` and note it.

### Error handling & security properties

- In production with a remote signer, the agent private key is never in the app's
  env or memory. The app holds only the agent public key and a scoped bearer
  token to the signer service.
- Remote signing failures are typed errors (action rejected), logged via
  `reportError`. No silent fallback to a local key.
- `rotate_agent` still works: the next agent key lives in the signer too; its
  public key comes from `PRAXIS_NEXT_AGENT_PUBLIC_KEY` (rotate only needs the
  pubkey, never the private key, to set `agent_authority`).
- The on-chain `agent_authority == signer` check is unchanged and remains the
  authoritative enforcement.

## Files

- **New:** `server/agent/agentSigner.ts` — `AgentSigner` interface,
  `LocalKeypairSigner`, `HttpRemoteAgentSigner`, `getAgentSigner` /
  `requireAgentSigner`, `resetAgentSignerForTests`.
- **Edit:** `server/env.ts` — resolve `agentSigner` into config; production guard;
  keep `agentKeypair` for `LocalKeypairSigner` + scripts.
- **Edit:** `server/aegis/client.ts` — use `agentSigner` for the 4 sign sites and
  pubkey reads; execute-only signing; simulate with `sigVerify: false`.
- **Edit:** `.env.example`, `README.md`, `docs/ROADMAP.md` — document the signer
  env and that custody is no longer a gap when configured.
- **New tests:** `server/agent/__tests__/agentSigner.test.ts`; update
  `server/aegis/__tests__/client.test.ts` and
  `server/provider/__tests__/praxisServer.test.ts` to inject an `AgentSigner`.

## Testing

- `LocalKeypairSigner` produces a signature that verifies against the agent
  pubkey on a built transaction.
- `HttpRemoteAgentSigner` (injected fake fetch): POSTs the base64 message with
  the bearer header, applies the returned signature, and **throws on a non-200 /
  network failure (fails closed)**; honors the timeout.
- `getAgentSigner` selection: remote when URL+pubkey+token present; local when a
  keypair is present; production guard refuses a raw key without the opt-in.
- `AegisClient`: signer is invoked on execute; simulate path works without a real
  signature.

## Rollout

- Local/devnet: no change (keypair → `LocalKeypairSigner`).
- Production: run a signer service holding the key (wrapping KMS/HSM/Turnkey), set
  `PRAXIS_AGENT_SIGNER_URL` / `PRAXIS_AGENT_PUBLIC_KEY` / `PRAXIS_AGENT_SIGNER_TOKEN`,
  and leave `PRAXIS_ALLOW_LOCAL_AGENT_KEY` unset so a raw key is refused.
