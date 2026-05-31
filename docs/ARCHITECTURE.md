# Praxis Architecture

Updated: 2026-05-31

Praxis has two parts:

- A Next.js product app that turns user intent into typed proposals.
- An Anchor program, Aegis, that enforces what the scoped agent key can do.

The product claim is simple: the agent may interpret intent, but the program
enforces the spending envelope.

## Runtime Modes

### Mock Mode

`NEXT_PUBLIC_PRAXIS_PROVIDER=mock` uses `MockPraxisProvider`.

- Runs fully in memory.
- Uses a deterministic rule-based parser.
- Exercises the same proposal, policy, and activity UI as API mode.
- Refuses to sign swaps, matching API mode.
- Intended for local development and smoke testing. Production builds disable
  mock mode unless `NEXT_PUBLIC_PRAXIS_ALLOW_MOCK=1` is deliberately set.

### API Mode

`NEXT_PUBLIC_PRAXIS_PROVIDER=api` uses `RemotePraxisProvider` and
`/api/praxis/*` route handlers.

- Reads policy and activity through `PraxisServerProvider`.
- Requires Solana wallet message signing and a signed HTTP-only session cookie.
- Derives the live policy PDA from the signed-in wallet address.
- Persists off-chain threads, proposals, and activity through the configured
  state repository (`postgres` for production, `fs` for local/devnet).
- Parses intent with the Google Gemini API or the local deterministic parser.
- Resolves address-book labels off-chain.
- Simulates through `AegisClient`.
- Signs agent actions with the configured scoped agent key.
- Builds wallet-signed owner/admin transactions when a signing wallet is present.

The filesystem state adapter is for local/devnet durability. Production should
use managed Postgres storage.

## Core Data Flow

1. User enters text in the conversation surface.
2. The selected `PraxisProvider` parses the text into a typed action.
3. Recipient names are resolved through the address book.
4. The provider builds a proposal with simulation, fee, and policy verdict.
5. The UI renders the proposal card.
6. On confirm, API mode signs an Aegis instruction with the scoped agent key.
7. Aegis enforces the policy on-chain before any value leaves the vault.
8. Policy and activity are refreshed into the UI.
9. Threads, proposals, and off-chain rejected activity are persisted by wallet.

## On-Chain Model

Aegis stores:

- `PolicyAccount`: owner, agent authority, SOL caps, SPL token caps,
  allow-lists, expiry, pause state, and rolling spend counters.
- Vault PDA: native SOL custody.
- Token vault account: associated token account owned by the vault PDA for the
  configured SPL mint.
- `ActionLog`: fixed-size ring buffer of allowed actions, including the mint
  moved by each record. Native SOL records use the default pubkey as mint.

Supported agent instructions:

- `agent_transfer`: native SOL transfer from the vault.
- `agent_transfer_spl`: SPL token transfer from the vault token account.

Both value paths enforce:

1. signer is `agent_authority`
2. policy is not paused
3. session is not expired
4. value is within per-transaction cap
5. rolling daily cap is not exceeded
6. recipient allow-list, when non-empty

The SPL path also enforces:

1. token envelope is configured
2. source and destination token accounts use the configured mint
3. source token account is owned by the vault PDA

Owner instructions are intentionally unconstrained by agent caps. The owner can
fund, withdraw, update policy, configure token envelope, revoke, and rotate.

## Swap Status

Swaps are not executable.

The app can parse a swap intent and run an agent-layer allow-list preview, but
the resulting proposal is always blocked. There is no Jupiter CPI and no
`agent_swap` instruction in the program.

This is deliberate. A real swap path must enforce mint/program allow-lists and
value caps inside the program instruction, not only in a quote or backend.

## Trust Boundaries

Trusted:

- Solana consensus.
- Aegis program enforcement.
- Owner wallet signatures for owner/admin actions.

Not trusted for enforcement:

- Prompt text.
- LLM output (Gemini or the deterministic parser).
- Mock parser.
- Server policy mirror.
- Frontend UI state.
- Swap preview logic.

The off-chain policy mirrors exist for explainability and simulation previews.
They are not the source of truth for value movement.

## Current Production Gaps

- Self-serve policy initialization is still script/bootstrap driven.
- The in-process agent signer is local/devnet oriented; production should use
  `PRAXIS_AGENT_SIGNER_URL`.
- Filesystem state is local/devnet durability; production should use
  `PRAXIS_STATE_BACKEND=postgres`.
- The in-memory rate limiter is process-local; production should use
  `PRAXIS_RATE_LIMITER=redis` plus platform/WAF controls.
- No durable rejected-transaction indexer for failures that happen outside the
  app process.
- No managed setup/funding product flow for SPL token vault balances.

## Verification Commands

```bash
bun run lint          # eslint
bun run test          # TypeScript suite: auth, validation, state, Aegis codec, routes
bun run build         # production Next.js build
bun run aegis:test    # rebuild the Anchor program + LiteSVM enforcement gate
```

Demo / scripted checks against a funded cluster:

```bash
bun run praxis:demo                  # end-to-end SOL send + over-cap rejection
bun run praxis:setup-token-accounts  # prepare vault/recipient ATAs for SPL
bun run praxis:moneyshots            # capture proposal/policy/activity states
bun run praxis:swapcheck             # assert swaps stay blocked
bun run praxis:tokencheck            # assert SPL envelope enforcement
```
