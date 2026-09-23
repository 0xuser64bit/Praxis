# Praxis architecture

Praxis has two parts:

- A Next.js app that turns user intent into typed proposals.
- An Anchor program, **Aegis**, that enforces what the scoped agent key can do.

The agent may interpret intent, but the program enforces the spending envelope.
Everything below is arranged around that split.

## Runtime modes

`NEXT_PUBLIC_PRAXIS_PROVIDER` picks the `PraxisProvider` that the UI talks to.

**Mock** (`mock`) uses `MockPraxisProvider` (`components/app/mock/`). It runs
entirely in memory with a deterministic parser. It uses the same proposal,
policy and activity UI as API mode, and it refuses to sign swaps just as API
mode does. It exists for local development. Production builds disable it
unless `NEXT_PUBLIC_PRAXIS_ALLOW_MOCK=1` is set at build time.

**API** (`api`, the default) uses `RemotePraxisProvider` against the
`/api/praxis/*` routes, which are backed by `PraxisServerProvider`
(`server/provider/praxisServer.ts`):

- Sign-in is a Solana wallet message signature that produces a signed,
  HTTP-only session cookie. The policy PDA is derived from the signed-in wallet.
- Threads, proposals, activity, contacts and schedules are stored per wallet in
  the configured state repository: `postgres` in production, `fs` for
  local/devnet.
- Intent is parsed by the LLM providers in `PRAXIS_INTENT_PROVIDERS` order
  (default `gemini,groq`), falling back to the local deterministic parser
  (`server/agent/localIntent.ts`). `PRAXIS_LOCAL_INTENT=1` skips the LLMs.
- A signed-in browser can call Gemini or Groq itself with a key kept in local
  storage. The server receives the model's tool arguments and normalizes them
  with the same checks as its own parse. It never receives or stores the key.
  If that call fails, or the normalizer rejects the reading, the message falls
  back to the shared providers, and the thread says so.
- Agent actions are simulated through `AegisClient` (`server/aegis/client.ts`)
  and signed with the scoped agent key, which lives either in-process or in the
  remote signer (`signer/`). Owner actions are built server-side and signed by
  the wallet (see [the owner relay](#trust-boundaries)).

## Request flow

1. The user types a message in the conversation.
2. The provider parses it into typed actions.
3. Recipient names resolve through the off-chain address book. A name that is
   ambiguous or unknown triggers a clarifying question, never a guess.
4. For each action the provider builds a proposal with the simulation, the fee
   and a policy verdict from the off-chain mirror of Aegis
   (`server/agent/policy.ts`).
5. The UI renders the proposal cards.
6. When the user confirms, the backend signs an Aegis instruction with the
   agent key and submits it.
7. Aegis enforces the policy on-chain before any value leaves the vault.
8. The policy and activity views refresh, and the result is persisted.

A proposal stays signable for **one week** (`PROPOSAL_TTL_SECONDS`). Its amount
is fixed when the card is built, and Aegis checks the envelope again when it
lands, so an old card still moves exactly what it says. What goes stale is the
card's reading: fee, simulated outcome, remaining envelope, and the USD figure
on a stock buy. A week is long enough for a weekly recurring buy fired on
Monday to still be signable on Sunday. It is short enough that nobody signs a
preview they no longer remember. This is a freshness contract. It is
deliberately not a second policy check.

## On-chain model (Aegis)

Source: `aegis/programs/aegis/src/`. Accounts:

- `PolicyAccount`, a PDA seeded by owner. It holds the owner, agent
  authority, SOL caps, SPL token envelope (one mint and its caps), allow-lists,
  expiry, pause flag and rolling spend counters.
- The vault PDA, which holds native SOL.
- A token vault: the vault PDA's associated token account for the configured
  mint.
- `ActionLog`: a fixed-size ring buffer of allowed actions, including the
  mint each one moved. Native SOL records use the default pubkey as the mint.

Agent instructions:

- `agent_transfer` moves native SOL from the vault.
- `agent_transfer_spl` moves the configured SPL Token or Token-2022 mint from
  the token vault.

Both refuse a zero amount, then check in this order:

1. The signer is `agent_authority`.
2. The policy is not paused.
3. The session has not expired.
4. The amount is within the per-transaction cap.
5. The rolling daily cap would not be exceeded.
6. The recipient is on the allow-list, when the allow-list is non-empty.

The SPL path also requires three things. A token envelope must be configured.
The source and destination accounts must use the configured mint. The source
account must be owned by the vault PDA.

**Vault rent.** The vault is a data-less system PDA, so the runtime rejects
any transaction that leaves it funded below the rent-exempt minimum. The agent
may spend only the balance above that reserve, and it can never close the
vault. The owner can leave the vault rent-exempt or sweep it to zero.

**Cap changes keep today's spend.** `configure_token` starts a fresh token
window only when the mint changes. Setting new caps on the same mint applies
them to today's spend, exactly as `update_policy` does for SOL. Otherwise
raising a cap would grant a second full allowance the same day, and lowering
one would hand the agent headroom it was meant to lose (LiteSVM T10).

**Token-2022.** `agent_transfer_spl` parses token accounts by hand and builds
the `TransferChecked` CPI itself, with no `anchor-spl` dependency. The token
program re-verifies the mint and decimals, so the mint is an account of the
instruction and must equal `policy.token_mint`. Token accounts must be at
least 165 bytes. An extended account must declare `AccountType::Account`,
which stops a mint being passed where a token account belongs. Two limits are
deliberate:

- A mint with an active **transfer hook** needs accounts this instruction does
  not pass, so the transaction reverts. No value moves, and no untrusted hook
  runs.
- A **transfer fee** debits the vault by the capped amount and credits the
  recipient less.

Off-chain, the provider resolves each mint's owning program before building
anything. It refuses up front, with distinct messages, when a mint belongs to
an unsupported token program or is missing from the cluster
(`checkMintMovable`). The token program is also a seed of the associated-token
address, so it is passed through every ATA derivation.
`PRAXIS_ALLOW_UNVERIFIED_MINTS=1` skips this pre-flight for offline tests only.

**Owner instructions** are fund, withdraw, update policy, configure token,
revoke, rotate and close. They are deliberately not limited by the agent caps.

**Swaps are not executable.** A swap intent is parsed and previewed against an
agent-layer allow-list, but the proposal is always blocked. There is no
`agent_swap` instruction and no Jupiter CPI. A real swap path must enforce
mint and program allow-lists and value caps inside the program, not in a quote
or the backend.

Enforcement tests: `aegis/programs/aegis/tests/enforcement.rs` (LiteSVM,
T1–T10). They cover cap boundaries, day rollover, signer checks, revoke,
allow-lists, admin invariants, SPL, Token-2022, vault invariants, and the
token window surviving a cap change.

## Stocks (PreStocks)

Code: `server/stocks/`. Stocks are enabled by `PRAXIS_STOCKS_ENABLED=1`. When
the flag is off, the token list and behavior are unchanged.

**Universe.** `server/stocks/universe.ts` pins the eight PreStocks mints. These
are the only pre-IPO tokens in the product. Do not list them in
`PRAXIS_TOKENS`. The flag merges them in. `PRAXIS_STOCK_UNIVERSE` filters and
orders them for display. It never bypasses enforcement.
`PRAXIS_STOCK_MINTS` swaps in mirror mints on a cluster where the real mints
do not exist. `bun run praxis:stockscheck` checks the live API against the
pinned mints.

**What the real mints are.** These facts were read from the mint accounts on
mainnet, not taken from the API:

- 9 decimals. The API does not report decimals, so amount math resolves the
  scale from the chain (`server/stocks/mintDecimals.ts`), unless
  `PRAXIS_STOCK_DECIMALS` pins it. When the scale cannot be confirmed, the
  agent refuses the buy.
- Token-2022, with extensions such as `PermanentDelegate`,
  `DefaultAccountState`, `TransferFeeConfig`, `TransferHook`,
  `PausableConfig` and metadata. The values that matter today are: the default
  account state is initialized, the transfer fee is 0 bps, and no transfer
  hook program is set. That is why the mints move like plain tokens. If
  PreStocks enables a hook or a fee, the limits above apply.
- The issuer (`WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc`) holds
  permanent-delegate, freeze and pause authority. The research card discloses
  this.
- The mints exist on mainnet only, so devnet uses mirror mints
  (`bun run praxis:setup-devnet-stocks`).

**Envelope model.** A wallet has one policy PDA, and a policy holds one SPL
envelope at a time. The active-stock switcher (`components/app/ActiveStock.tsx`)
reconfigures that envelope to the selected stock's mint with one owner
signature. `get-policy?mint=` only selects the *view*. It never changes which
account is read. A priced stock's envelope defaults to $100 per buy and $500
a day, converted to token quantities at the current price.

**Dollar amounts.** When a request carries a `$` (`buy $40 openai`,
`set my daily limit to $100`), the server converts it to base units at the
PreStocks `tokenPrice` with integer math, and says which price it used. With
no price, it asks for clarification rather than reading the number as a
quantity. Aegis only ever sees token quantities.

**Research** (`server/agent/research.ts`, `server/stocks/prestocks.ts`)
starts with the PreStocks rows (token and mark price, labeled separately),
then adds on-chain supply and DexScreener data. If the PreStocks API fails,
the research card is still built from the other sources. It is never replaced
by an error. Research never produces buy, sell or hold advice.

**Recurring buys** (`server/stocks/schedules.ts`, `scheduleRunner.ts`). A
schedule has a daily, weekly or monthly cadence. Its quantity is fixed when
it is created. Each fire emits a proposal through the same policy check as a
one-off buy and never signs. Firing is driven by `/api/cron/stocks` (see
[DEPLOY.md](DEPLOY.md#scheduled-recurring-buys)). The same endpoint also
answers a session cookie for the signed-in wallet's own schedules. Fire times
are anchored to `PRAXIS_SCHEDULE_HOUR_UTC`, because a schedule timed after the
single daily tick would slip a day.

**Baskets** split a dollar total across their constituents at live prices,
using integer math. They are all-or-clarify. Every constituent is simulated
first. If any is blocked, unmovable or unpriceable, the whole basket becomes a
clarification and nothing is stored.

**Demo faucet** (`server/stocks/demoFaucet.ts`). This is devnet only and is
enabled by `PRAXIS_DEMO_FAUCET_KEYPAIR`. It mints $1,000 of the active mirror
stock into the signed-in wallet's vault, so any wallet can complete a buy.
Three independent guards stop it running anywhere else. It refuses a
non-mirror mint. It refuses mainnet, detected by genesis hash. It refuses
unless its key is the mint authority. It is limited to 3 grants per wallet
per day.

## Concurrency and state

The provider is rebuilt from the repository on every request. Nothing is
cached in memory across requests. Within one instance, a per-wallet async
mutex serializes `send`, `signProposal` and `cancelProposal`.

Across instances, durable state uses **optimistic concurrency**. The stored
document carries a monotonic `rev`, and every write compares against the
revision it read and only swaps if it still matches. A wallet's own writes are
chained inside the provider, so a conflict always means a genuinely concurrent
writer elsewhere.

- **Signing is exactly-once.** `signProposal` first *claims* the proposal: it
  changes it from `pending` to `signing` and writes that at the loaded
  revision. Only one writer wins the swap. The loser reloads, sees a
  non-pending proposal and returns without submitting. If signing fails before
  submission, nothing has reached the chain, so the proposal goes back to
  `pending` and the error is shown.
- **Schedule fires are at-most-once.** A due schedule's `nextFireTs` is
  advanced and written *before* any proposal is built. A crash between the
  claim and the card misses one fire, and for money that is the right way to
  fail.
- **Conversation data** (threads, activity, contacts) resolves conflicts by
  deliberate, logged last-write-wins. It reloads the newer revision and
  rewrites.
- **Sign-in nonces** are claimed through a shared store: `SET NX EX` on Redis
  when `REDIS_URL` or Upstash is configured, or in memory otherwise. The nonce
  store fails **closed**: if a configured store cannot answer, sign-in is
  refused. The rate limiter fails **open**, to a process-local limiter.

## Trust boundaries

**Trusted:** Solana consensus, Aegis enforcement, and owner wallet signatures
on owner actions.

**Not trusted for enforcement:** prompt text; LLM output, including a reading
the browser produced with the owner's own key; the deterministic parser; the
server policy mirror; frontend state; swap preview logic. The off-chain
mirrors exist to explain and preview. They are not the source of truth for
value movement.

**Not trusted as data.** Several inputs are length-limited and normalized in
`server/agent/untrusted.ts` before they reach any surface:

- Market-indexer fields. Anyone who mints a token chooses its `symbol` and
  `name`. React escapes markup, so the concern is a 4 KB "ticker" that breaks
  its card, or bidi and zero-width characters that rewrite the line they sit
  in. Indexer addresses are validated as real keys at this same point.
- PreStocks quote fields, including an http(s) check on any URL quoted into
  the research summary.
- LLM output, which is limited in both field length and action count. Every
  action costs a simulation, RPC round-trips and a card for the user to read.

Research informs. It never authorizes. Conversation history is not replayed to
the model. Each turn sends only the current line, so text an indexer returns
cannot steer a later parse.

**The owner relay.** `/owner/build` returns an unsigned transaction plus a
backend-signed fingerprint of it (`server/aegis/ownerDraft.ts`).
`/owner/submit` accepts only that exact transaction, signed by the session's
wallet. This means users cannot skip the server-side preconditions on owner
actions by assembling their own bytes. Examples are the refusal to close a
vault that still holds tokens, and the movable-mint check on configure.
The on-chain `has_one = owner` check remains the enforcement of record.

**The session is a spending credential.** Praxis signs agent transfers with its
own key, so a valid session is enough to move value *within* the envelope with
no further wallet signature. Sessions are therefore short-lived
(`PRAXIS_SESSION_TTL_HOURS`, default 24) and bound to the connected wallet
account. Switching accounts in the extension, or disconnecting, ends the
session.

**Shared agent key.** The configured agent key is the on-chain authority on
every wallet's policy. In production the backend refuses to serve more than
the one configured owner under an in-process key, unless
`PRAXIS_ALLOW_SHARED_AGENT_KEY=1` is set or the key sits behind the remote
signer.

## Known gaps

- **Agent key custody.** The in-process agent key is meant for local and
  devnet use. Production should use the remote signer
  (`PRAXIS_AGENT_SIGNER_URL`). The signer logs every outcome, and those lines
  are the only record of what the agent key signed. Shipping them somewhere
  durable is the operator's job.
- **State backend.** Filesystem state lives on one instance and does not
  survive redeploys. Production should use `PRAXIS_STATE_BACKEND=postgres`.
- **Redis.** Without Redis, rate limits and nonce single-use hold per instance
  only. A multi-instance deployment should set `REDIS_URL` or Upstash
  credentials.
- **Concurrent owner edits.** Owner policy edits read the full allow-list
  vectors, modify them and write them back. The program takes whole
  `Vec<Pubkey>` values and cannot compare-and-swap, so two edits built from
  the same read clobber each other. The window is one blockhash lifetime, and
  the worst case is a lost allow-list entry, not lost funds. Fixing it needs a
  nonce on `PolicyAccount`, which means a change to the account layout and a
  migration.
- **Rejected actions.** No durable indexer records transactions rejected
  outside the app process.
- **Cron scale.** The scheduled-buy job walks at most 500 wallets per tick.
  Beyond that it needs partitioning or a work queue.
- **Token-vault funding** has no product UI (see
  [DEPLOY.md](DEPLOY.md#verifying-a-cluster) for the script).
