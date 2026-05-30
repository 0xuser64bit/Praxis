# Praxis Architecture

Updated: 2026-05-30

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

### API Mode

`NEXT_PUBLIC_PRAXIS_PROVIDER=api` uses `RemotePraxisProvider` and
`/api/praxis/*` route handlers.

- Reads policy and activity through `PraxisServerProvider`.
- Parses intent with Anthropic Messages API or the local demo parser.
- Resolves address-book labels off-chain.
- Simulates through `AegisClient`.
- Signs agent actions with the configured scoped agent key.
- Uses a demo mutation token, not production authentication.

The server provider is still an in-memory singleton. That is acceptable for a
demo, but it is not a production state model.

## Core Data Flow

1. User enters text in the conversation surface.
2. The selected `PraxisProvider` parses the text into a typed action.
3. Recipient names are resolved through the address book.
4. The provider builds a proposal with simulation, fee, and policy verdict.
5. The UI renders the proposal card.
6. On confirm, API mode signs an Aegis instruction with the scoped agent key.
7. Aegis enforces the policy on-chain before any value leaves the vault.
8. Policy and activity are refreshed into the UI.

## On-Chain Model

Aegis stores:

- `PolicyAccount`: owner, agent authority, SOL caps, SPL token caps,
  allow-lists, expiry, pause state, and rolling spend counters.
- Vault PDA: native SOL custody.
- Token vault account: associated token account owned by the vault PDA for the
  configured SPL mint.
- `ActionLog`: fixed-size ring buffer of allowed actions.

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
- Owner key for owner/admin actions.

Not trusted for enforcement:

- Prompt text.
- LLM output.
- Mock parser.
- Server policy mirror.
- Frontend UI state.
- Swap preview logic.

The off-chain policy mirrors exist for explainability and simulation previews.
They are not the source of truth for value movement.

## Current Production Gaps

- No real authentication or authorization.
- Public demo mutation token is not production auth.
- Server-side key custody is demo-only.
- No durable database.
- No rate limits.
- No rejected-action indexer.
- No live setup flow for SPL token vault/recipient accounts.
- No historical mint stored in `ActionRecord`, so SPL activity can be mislabeled
  after token reconfiguration.

## Verification Commands

```bash
bun run lint
bun run build
bun run praxis:moneyshots
bun run praxis:swapcheck
bun run praxis:tokencheck
bun run aegis:test
```
