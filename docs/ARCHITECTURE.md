# Praxis Architecture

Updated: 2026-09-22

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
- Parses intent with the configured LLM providers in order (`PRAXIS_INTENT_PROVIDERS`,
  Gemini then Groq by default), falling back to the local deterministic parser.
  Free-tier quotas are per-provider, so a second name there is what keeps a
  parse working after the first runs out for the day.
- Resolves address-book labels off-chain.
- Simulates through `AegisClient`.
- Signs agent actions with the configured scoped agent key.
- Builds wallet-signed owner/admin transactions when a signing wallet is present.

The filesystem state adapter is for local/devnet durability. Production should
use managed Postgres storage.

### Concurrency Model

The provider is reconstructed per request from the repository (no cross-request
in-memory cache), so concurrent `send` / `signProposal` / `cancelProposal`
calls for the same wallet are serialized by a per-wallet async mutex
(single-instance).

Across instances the mutex is useless, so durable state uses **optimistic
concurrency**: the stored document carries a monotonic `rev`, and every write
compare-and-swaps against the revision it was read at. A wallet's own writes
are chained inside the provider, so a surfaced conflict always means a genuinely
concurrent writer elsewhere.

`signProposal` **claims** the proposal before it signs anything: it flips
`pending → signing` and CAS-writes at the loaded revision. Only one writer can
win that swap; the loser reloads, sees a non-`pending` proposal, and returns
without submitting. That makes execution exactly-once across instances, not
just within one process — previously two instances could each read the same
`pending` proposal and both submit an `agent_transfer` (bounded by the Aegis
caps, but two real transfers).

Schedule firing claims the same way, and claims *first*: a due schedule's
`nextFireTs` is advanced and CAS-written before any proposal is built. The
scheduled-buy job fans out across wallets and the same endpoint is reachable
from a signed-in session, so two callers could otherwise both read a schedule
as due, both emit a card, and the loser's write revert the winner's advance —
leaving it due again next tick. Claiming first makes a fire at-most-once: a
crash between the claim and the card misses a fire, which for money is the
right direction to fail.

For the conversational document (threads, activity, contacts) a conflict
resolves as a deliberate, logged last-write-wins: reload the newer revision and
rewrite. Wallet challenge nonces are claimed through a shared nonce store (`SET NX EX`
on Redis when `REDIS_URL` or Upstash credentials are configured, in-memory
otherwise), so a captured signature cannot be replayed against a second
instance. Unlike the rate limiter, which fails OPEN, the nonce store fails
CLOSED: if a configured store cannot answer, sign-in is refused rather than
degraded to per-instance nonces.

## Core Data Flow

1. User enters text in the conversation surface.
2. The selected `PraxisProvider` parses the text into a typed action.
3. Recipient names are resolved through the address book.
4. The provider builds a proposal with simulation, fee, and policy verdict.
5. The UI renders the proposal card.
6. On confirm, API mode signs an Aegis instruction with the scoped agent key.
   A proposal is signable for a week. Its amount is fixed when the card is
   built and Aegis enforces the envelope live at submit, so an older card
   still moves exactly what it says; what drifts is the reading — fee,
   simulated outcome, remaining envelope, the USD figure on a stock buy. The
   bar is therefore forgetting rather than drift: long enough that a weekly
   recurring buy fired on Monday is still signable on Sunday, short enough
   that nobody signs a preview from last month. A freshness contract,
   deliberately not a second copy of the policy check.
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

and refuse a zero amount outright — it moved nothing, paid a fee, and wrote an
audit-log row saying an action happened.

The vault is a data-less system PDA, so the runtime rejects any transaction
that leaves it funded below the rent-exempt minimum. "The vault holds N" is
therefore not "N is spendable": the agent may only spend above the reserve and
can never deallocate the vault, while the owner may either leave it rent-exempt
or sweep it to zero. Measuring against `lamports()` instead produced an opaque
`InsufficientFundsForRent` where a typed Aegis error belongs.

The SPL path also enforces:

1. token envelope is configured
2. source and destination token accounts use the configured mint
3. source token account is owned by the vault PDA

`agent_transfer_spl` drives **SPL Token or Token-2022**, hand-parsing the
token accounts and constructing the CPI raw (no `anchor-spl` dependency). The
CPI is `TransferChecked`, so the token program re-verifies the mint and
decimals rather than trusting a caller-supplied number; the mint is therefore
an account of the instruction and must equal `policy.token_mint`. Token
accounts must be `>= 165` bytes — Token-2022 appends a type byte and TLV
extensions to the classic base — and an extended account must declare
`AccountType::Account`, which is what stops a mint being passed where a token
account belongs.

Two deliberate limits: a mint with an active **transfer hook** needs accounts
this instruction does not pass, so the CPI fails and the transaction reverts
(safe — no value moves, no untrusted hook runs); and a **transfer fee** debits
the vault by the capped amount while crediting the recipient less, which is
correct for a spending policy but means the recipient may receive slightly
less than the card showed.

Off-chain, the provider resolves each mint's owning program on the transfer
cluster and refuses up front — with distinct messages for "unsupported token
program" and "not on this cluster" — instead of failing deep in simulation.
The token program id is also a *seed* of the associated-token address, so it
is threaded through every ATA derivation; a wrong default computes an address
that would never hold the tokens. `PRAXIS_ALLOW_UNVERIFIED_MINTS=1` skips the
pre-flight check for offline tests and demos — never set it in production.

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
- LLM output (Gemini, Groq, or the deterministic parser).
- Mock parser.
- Server policy mirror.
- Frontend UI state.
- Swap preview logic.

The off-chain policy mirrors exist for explainability and simulation previews.
They are not the source of truth for value movement.

Not trusted as *data* either — bounded and normalized at the seam
(`server/agent/untrusted.ts`) before reaching any surface:

- Market-indexer fields. A token's `symbol` and `name` are chosen by whoever
  minted it, which is anyone. React escapes markup, so this is not about XSS:
  it is a 4KB "ticker" that destroys the card it lands on, and bidi overrides
  and zero-width marks that let a value rewrite the line it sits in. Addresses
  from an indexer are validated as real keys at the same point, rather than
  carried as identifiers until something downstream happens to parse one.
- PreStocks quote fields, including an http(s) check on the URL the research
  summary quotes into its own sentence.
- LLM output, which is bounded in both field length and action count — each
  action costs a simulation, RPC round-trips, and a card to read.

Research informs; it never authorizes. Conversation history is not replayed to
the model — each turn sends only the current line — so text an indexer returns
cannot steer a later parse.

**The owner relay.** `/owner/build` returns an unsigned transaction plus a
backend-signed fingerprint of it; `/owner/submit` refuses anything that is not
that transaction, signed by the session's wallet. Without that binding the
program allow-list was the only real check, and the server-side preconditions
attached to an action — the "your vault still holds tokens" refusal on close,
the movable-mint check on configure — were skippable by assembling your own
bytes. On-chain `has_one = owner` remains the enforcement of record; this is
what makes the layer above it coherent.

**The session is a spending credential.** Praxis signs agent transfers with its
own scoped key, so holding a valid session is enough to move value *within* the
envelope with no further wallet signature. It is therefore short-lived
(`PRAXIS_SESSION_TTL_HOURS`, default 24) and bound to the connected wallet
account: switching accounts in the extension, or disconnecting, ends it.

## Current Production Gaps

- Self-serve policy initialization is still script/bootstrap driven.
- The in-process agent signer is local/devnet oriented; production should use
  `PRAXIS_AGENT_SIGNER_URL`.
- Filesystem state is local/devnet durability; production should use
  `PRAXIS_STATE_BACKEND=postgres`.
- The in-memory rate limiter is process-local; production should use
  `PRAXIS_RATE_LIMITER=redis` plus platform/WAF controls.
- Without Redis configured, nonce single-use is per instance only — multi-
  instance deployments should set `REDIS_URL` (or Upstash credentials).
- The remote signer enforces a per-process signature ceiling and logs every
  outcome; those lines are the only record of what the agent key signed, and
  shipping them somewhere durable is the operator's job.
- Rate limits degrade to a process-local limiter when the shared store is
  unavailable, which is weaker than shared state across instances.
- Owner policy edits are read-modify-write against the full allow-list vectors:
  the program takes whole `Vec<Pubkey>`s and has no compare-and-swap, so two
  owner edits building from the same read would clobber each other. The window
  is one blockhash lifetime (the draft token expires in five minutes and the
  blockhash sooner), and the blast radius is a lost allow-list entry rather
  than lost funds. Closing it properly needs a nonce on `PolicyAccount`, which
  changes the account layout and so needs a migration.
- No durable rejected-transaction indexer for failures that happen outside the
  app process.
- The scheduled-buy job walks every wallet in one tick (bounded at 500). Past
  that it needs partitioning or a work queue.
- No managed setup/funding product flow for SPL token vault balances.

## Verification Commands

```bash
bun run lint          # eslint
bun run test          # TypeScript suite: auth, validation, state, Aegis codec, routes
bun run build         # production Next.js build
bun run aegis:test    # rebuild the Anchor program + LiteSVM enforcement gate (T1–T9)
bun run aegis:idl     # rebuild and re-sync the generated IDL into @praxis/shared
```

Demo / scripted checks against a funded cluster:

```bash
bun run praxis:demo                  # end-to-end SOL send + over-cap rejection
bun run praxis:setup-token-accounts  # prepare vault/recipient ATAs for SPL
bun run praxis:moneyshots            # capture proposal/policy/activity states
bun run praxis:swapcheck             # assert swaps stay blocked
bun run praxis:tokencheck            # assert SPL envelope enforcement
bun run praxis:reenablecheck         # revoke -> re-enable, signing follows the chain
bun run praxis:reenablecycles        # the same, repeated N times (CYCLES=3)
bun run praxis:policycheck           # chat-driven policy change lands on-chain
bun run praxis:localcheck            # docker Postgres + Redis, incl. CAS rejection
bun run praxis:setup-devnet-stocks   # create Token-2022 mirror mints on the demo cluster
bun run praxis:stocksbuycheck        # stock buy lands; over-cap refused on-chain
```
