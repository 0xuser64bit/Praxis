# Praxis / Aegis defensive security review

Date: October 29, 2026 (Asia/Kolkata; command logs use UTC).

## Executive security summary

Four service-layer defects were confirmed: **two Medium and two Low**. All four
received focused local patches and passing security-property regression tests.
No new Critical/High issue or on-chain authorization/spending-cap bypass was
confirmed in the reviewed working tree.

The most consequential finding was a persistence conflict handler that defeated
otherwise-correct compare-and-swap proposal claims. An unrelated stale refresh
could restore an executed proposal to `pending`, allowing a later confirmation
request to execute that proposal again. A local service test observed two
execution calls before remediation and exactly one afterward.

This is a bounded source-and-local-test review, **not an exhaustive full-repository
audit, formal proof, independent dual review, or deployment safety certification**.
All production Aegis Rust files were inspected. Off-chain critical paths were
reviewed selectively; frontend, SDK, infrastructure and dependency coverage is
partial. Limitations are itemized below rather than treated as passing checks.

| ID | Status | Severity | Confidence | Local remediation |
|---|---|---|---|---|
| S-01 | Confirmed | Medium, 6/10 | High | Verified: stale writes fail closed |
| S-02 | Confirmed | Medium, 5/10 | High | Verified: production requires shared replay protection |
| S-03 | Confirmed | Low, 3/10 | High | Verified: unexpected error messages/types are redacted |
| S-04 | Confirmed | Low, 3/10 | High | Verified: signer body consumption is bounded |

Severity reflects actual preconditions and scope. S-01 is bounded by on-chain
caps and requires stale state plus a subsequent confirmation request; S-02
requires possession of an already-valid signed login challenge; S-03 does not
demonstrate extraction of a real secret; S-04 requires the signer bearer token.

## Scope, baseline and safety

- Repository: `/Users/user64bit/Code/Praxis`.
- Base commit: `4c5aa29f1b688efe52bbb3095269ebc3629387ed`.
- Target: the supplied **dirty working tree**, not pristine HEAD. Pre-existing
  edits included Anchor 1.0.2 pins, account-validation/enforcement tests, API body
  handling, and pending nonce/signer/error regression assertions. These were
  preserved. This review does not claim authorship of those pre-existing edits.
- Program dependency: `anchor-lang = "=1.0.2"`; local SVM: LiteSVM 0.10.0.
- Installed verification tools: Node v26.12.1, host rustc 1.99.1,
  Solana CLI 4.3.2 and cargo-build-sbf 4.4.0 (platform-tools v1.57,
  SBF rustc 1.95.0). `Anchor.toml` requests Solana 3.1.15, so this review does
  not claim exact toolchain parity with that configured deployment version.
- All execution remained local. No public RPC, production account, external
  service, deployment, live exploit, external advisory collector or remote
  credential was used. Keys/signatures in tests are generated fixtures.
- Installed skills used as guidance: `auditor-skill` (primary), `solana-dev`,
  `rust-review`, `entry-point-analyzer`, `fp-check`, `variant-analysis`,
  `dimensional-analysis`, `sharp-edges`, and `supply-chain-risk-auditor`.
  Remediation also used the installed testing/debugging/verification guidance.
- The requested `solana-fuzz`, `qedgen` and `qedgen-auditor` skills were not
  available in the supplied installed-skill inventory. No replacement skill
  repository was cloned or installed. Native LiteSVM state-sequence tests were
  used instead of representing unavailable fuzzing/formal tools as executed.
- Two delegated reviews failed at the provider usage limit before delivering
  findings. Review continued directly; **no independent second-review result is
  claimed**.

## Protocol reconstruction

### Assets, accounts and authorities

`PolicyAccount` is program-owned and derived from `[b"policy", owner]`.
`ActionLog` is program-owned and derived from `[b"action_log", policy]`.
The SOL vault is a **system-owned, zero-data PDA**, not a program-owned data
account, derived from `[b"vault", policy]`. Aegis signs its system/token CPIs
using those vault seeds and the canonical bump.

The owner controls policy creation, limits, allow-lists, funding, SOL withdrawal,
revoke, rotation and teardown. Agent transfers require a transaction signer
equal to `policy.agent_authority`; possession of an arbitrary signature is not
sufficient. Owner SOL withdrawals deliberately bypass the agent envelope.

Token source and destination accounts belong to either classic SPL Token or
Token-2022, and both must use the same selected supported program. The token
source's internal authority must equal the vault PDA; source/destination mint
must equal `policy.token_mint`. Recipient restrictions use the destination
token account's internal owner, not an arbitrary caller-supplied wallet label.

### State-changing entry points

| Instruction | Authority and constraints | State/value effect |
|---|---|---|
| `initialize_policy` | Owner signer; `init`; canonical owner-scoped policy/log PDAs | Creates policy/log; sets agent; disables token envelope initially |
| `update_policy` | Owner signer; owner seeds and `has_one` | Changes SOL caps/lists/expiry/pause; preserves live spend counters |
| `configure_token` | Owner signer; owner seeds and `has_one` | Sets single mint and token caps; same mint preserves spend, changed mint resets token units/window |
| `fund_vault` | Owner signer; linked policy/vault; fixed System program | Owner SOL to vault; validates positive amount/rent threshold |
| `withdraw_vault` | Owner signer; linked policy/vault; fixed System program | Vault SOL to owner, including full sweep; preserves rent or leaves zero |
| `agent_transfer` | Registered agent signer; policy/vault/log PDA checks | Policy-gated native transfer and allowed-action log entry |
| `agent_transfer_spl` | Registered agent signer; linked PDAs; token ownership/mint/authority checks | Policy-gated `TransferChecked` CPI and allowed-action log entry |
| `revoke_agent` | Owner signer; owner seeds and `has_one` | Zeroes agent authority and pauses |
| `rotate_agent` | Owner signer; owner seeds and `has_one`; nondefault new key | Replaces agent and unpauses, without resetting spend |
| `close_policy` | Owner signer; linked policy/log/vault; Anchor close constraints | Sweeps vault SOL; closes policy/log and returns rent |

Primary sources: `aegis/programs/aegis/src/lib.rs:30`,
`aegis/programs/aegis/src/state.rs:33`, and all ten files under
`aegis/programs/aegis/src/instructions/`.

### Value flows and external trust boundaries

1. Owner SOL enters the deterministic vault through `fund_vault` or a direct
   external SOL credit. Agent SOL debits cannot consume the rent reserve.
2. Vault-controlled SPL accounts hold tokens. Agent token transfers consume a
   dedicated mint/base-unit envelope, separate from lamports.
3. SPL movement uses `TransferChecked`, with decimals read from the pinned mint.
   The spending limit measures source debit, not net recipient credit after fees.
4. The application calls a stock transfer a buy, but the reviewed on-chain path
   transfers an already-custodied token. There is no implemented Jupiter swap,
   on-chain exchange price, lending position or collateral valuation invariant.
5. Web sessions identify a wallet and permit application agent-signing requests.
   Owner administrative transactions instead need owner signatures. Owner-draft
   HMACs bind relay submissions to the built instructions, metas, payer and
   blockhash, with explicitly permitted priority-fee changes.
6. Model output, token research and prices are untrusted proposal inputs, not
   on-chain authorization. A proposal transitions from pending through signing
   and submitted to a terminal outcome; persistence must not reverse a claim.
7. PostgreSQL state and Redis nonce claims are cross-instance trust boundaries.
   The remote signer holds the shared scoped agent key and authenticates the
   app with a bearer token. Aegis remains authoritative for spending constraints.
8. Upgrade authority, cluster consensus, canonical token programs, RPC integrity,
   owner-key custody, operator secrets and configured token issuers are trusted
   assumptions. Actual deployed authorities were not inspected.

### Security invariants reviewed

- Only an owner can mutate that owner's policy or sweep the SOL vault.
- Only the registered, nonrevoked agent can invoke agent spending paths.
- Paused or expired policies cannot spend; expiry is checked before rollover.
- Positive amounts, per-transaction limits, live-window aggregate limits and
  recipient restrictions hold independently for SOL and the configured mint.
- Raising/lowering limits or rotating keys does not restore already-spent
  allowance for the same live asset/window.
- CPI program, mint, source authority and derived vault cannot be substituted.
- Failed actions leave policy, value balances and durable log unchanged.
- Initialization cannot overwrite a live policy; close/recreation must not
  restore a former agent automatically.
- Off-chain proposal execution is at-most-once per proposal across requests,
  and cancelled schedules/advanced schedule claims cannot be resurrected by a
  stale document write.
- Login challenge single-use is global across production replicas, not merely
  local to one process.
- Network input consumption and client-visible unexpected errors are bounded.

## Confirmed findings, ordered by severity

### S-01 — Conflict recovery overwrites newer execution state

**Severity:** Medium, 6/10. **Confidence:** High.
**Status:** Confirmed; remediated locally.

**Affected functions:** `PraxisServerProvider.persist`, `refreshOnChain`,
`signProposal`, and other whole-document mutation/persistence callers.
Current fix: `server/provider/praxisServer.ts:2118`.
Execution claim: `server/provider/praxisServer.ts:2164`.

**Violated invariant:** a successfully claimed/submitted/executed proposal
cannot become pending again because an unrelated writer used an older snapshot.

**Root cause and exact pre-fix behavior:** the generic persistence conflict
handler loaded only the newer revision, then saved the **old document** at that
revision. It did not merge or adopt the newer security state:

```ts
const latest = await this.repository.load(this.ownerKey);
this.rev = latest?.rev ?? 0;
this.rev = await this.repository.save(this.ownerKey, this.snapshot(), this.rev);
```

**Conditions and controlled inputs:** two providers for the same authenticated
wallet hold different-age snapshots; a pending proposal is executed by one;
an older provider later commits, for example during `refreshOnChain`; a later
confirmation/retry names the same proposal. A second chain payment additionally
requires a fresh transaction/blockhash and enough remaining allowance/balance.
The real builder fetches a blockhash on each build at
`server/aegis/client.ts:1176`. No foreign-wallet authentication bypass is claimed.

**Trace and impact:** stale `pending` snapshot → winner claims/submits/marks
`signed` → stale refresh loses CAS → conflict handler upgrades revision without
adopting data → `pending` overwrites `signed` → later claim succeeds again.
This permits repeated execution of one logical approval within the on-chain
envelope. It is not an unlimited on-chain cap bypass.

**Counterchecks:** the per-owner mutex serializes calls, but cannot correct an
already-loaded stale provider. The PostgreSQL CAS is correct for an existing
row, but the retry explicitly supplies its new revision. The proposal claim
itself uses strict CAS; an unrelated generic write undermines that protection.

**Local validation:** `audit_1/security-regressions.mjs:83` uses independent
cloned provider snapshots and an atomic in-memory repository. Before the patch,
one executed proposal produced **two** local execution calls. Afterward the
stale refresh rejects with `PraxisConflictError`, the stored state remains
`signed`, and the retry produces no second call. This validates real provider
orchestration with mocked chain I/O, **not two broadcast production payments**.
The same invariant is also added to the normal Bun suite at
`server/provider/__tests__/praxisServer.test.ts:256`.

**Variants:** cancelled schedule resurrection is reproduced at
`audit_1/security-regressions.mjs:104`. Rollback of `signing`, `submitted`,
proposal cancellation and `nextFireTs` has the same full-snapshot overwrite
mechanism; those additional interleavings were inspected statically rather
than separately machine-reproduced. No second equivalent revision-upgrade
overwrite handler was found in the targeted persistence search.

**Minimal remediation:** all writes to this mixed conversation/execution
document must use strict CAS. The patch delegates generic persistence to
`casSave` and propagates conflicts instead of rebasing an old snapshot onto a
new revision. This preserves successful writes and the existing claim flow;
conflicting non-idempotent requests require reload/re-decision, not blind retry.

**Verification status:** passing local service regressions and app/SDK
typechecks. Actual multi-process PostgreSQL timing and RPC broadcast behavior
were not machine-verified. The filesystem backend still only supports its
documented single-process concurrency model.

### S-02 — Production silently selects replica-local login replay protection

**Severity:** Medium, 5/10. **Confidence:** High.
**Status:** Confirmed; remediated locally.

**Affected functions:** `getNonceStore`, `MemoryNonceStore.consume`,
`verifyWalletChallenge` / `consumeNonce`.
Fix: `server/auth/nonceStore.ts:148`.
Verification call: `server/auth/challenge.ts:88`.

**Violated invariant:** one valid wallet challenge signature can establish
authentication only once across all serving production instances.

**Root cause:** if no complete shared Redis configuration was found,
`getNonceStore` unconditionally constructed `MemoryNonceStore`, including in
production. Separate processes maintained independent used-nonce maps, and a
restart similarly forgot used nonces. Incomplete REST credentials also silently
selected this weak fallback.

**Conditions and impact:** a signed challenge triple is captured after or around
legitimate redemption, remains within its five-minute lifetime and correct
origin, and is replayed to another instance (or a restarted one). The common
HMAC secret validates the challenge on both. Replay can establish a new wallet
session, which can request agent transfers within that owner's envelope. The
finding does not forge a wallet signature, defeat HMAC, cross an origin check or
assume that an attacker can obtain an unobserved challenge signature.

**Counterchecks:** expiry, origin binding, signature verification before nonce
consumption and atomic `SET NX EX` for configured Redis are valid defenses.
They do not make separate in-memory stores global. A shared store outage was
already caught fail-closed; the gap was silently choosing no shared store.

**Local validation:** two distinct memory stores both claim the same nonce at
`audit_1/security-regressions.mjs:150`. The stronger test at
`audit_1/security-regressions.mjs:155` generates a real Ed25519 fixture signature
and invokes `verifyWalletChallenge`: replay is rejected against the same store
but accepted after substituting an independent replica-local store. The
production-configuration regression at `audit_1/security-regressions.mjs:122`
failed before the patch and now rejects missing/incomplete shared credentials.

**Variants:** omitted credentials, incomplete Upstash/KV credentials, multiple
serverless processes and process restart all expose the same local-store scope
problem. Native RESP and REST implementations both perform atomic claims when
properly shared; no second weak production fallback was identified in this path.

**Minimal remediation:** require `REDIS_URL` or complete Upstash/KV credentials
in production; retain the in-memory implementation for development/tests.
Update deployment and environment documentation accordingly.

**Verification status:** local cryptographic/configuration regressions pass.
Real Redis networking, shared-store retention/eviction policies and production
configuration were **Not machine-verified**. Production sign-in now intentionally
fails closed unless a shared replay store is configured and available.

### S-03 — Unexpected errors disclose internal messages and class names

**Severity:** Low, 3/10. **Confidence:** High.
**Status:** Confirmed; remediated locally.

**Affected function:** `jsonError`, `server/api/json.ts:31`;
redaction: `server/api/json.ts:61`.

**Violated invariant:** unclassified internal failures must not return arbitrary
upstream exception strings or implementation-specific names to API callers.

**Root cause:** only configuration errors received generic messages. Ordinary
`Error` instances were otherwise returned using `error.message` and
`error.name`, even for an internal HTTP 500 response.

**Conditions and impact:** a request reaches a path throwing an unexpected
database/RPC/runtime exception. Callers see whatever sensitive operational data
that exception contains. Local validation proves verbatim internal-string and
class-name disclosure, **not extraction of any actual deployment credential**.
Anonymous and authenticated exposure depends on the route producing the error.

**Counterchecks:** configuration errors were already masked and errors were
already logged server-side. Neither protected the general unexpected-error
branch. User-actionable typed errors and unknown transaction outcomes must remain
distinguishable to avoid unsafe transaction retries.

**Local validation:** `audit_1/security-regressions.mjs:219` injected a synthetic
internal error and failed before the patch because both its private-looking
message and class name reached the JSON response. It now receives a generic
`internal_error`. `audit_1/security-regressions.mjs:229` confirms that
`PraxisSubmittedError` still carries its signature and do-not-retry message.

**Variants and remediation:** this is a centralized response helper, so one
fix covers its API consumers. Preserve explicitly recognized public typed
errors, mask unclassified 500 messages/types/details, and retain operator logs.
Other UI-facing research/status prose was not exhaustively sanitized in this
review and is not covered by this remediation claim.

**Verification status:** passing local response tests, ESLint and typechecks.
No actual secret leak or comprehensive route-by-route failure injection was
machine-verified.

### S-04 — Signer parses authenticated bodies before applying an input budget

**Severity:** Low, 3/10. **Confidence:** High.
**Status:** Confirmed; remediated locally.

**Affected function:** `createSignerHandler`, `signer/handler.ts:96`.
Body budget: `signer/handler.ts:26`.

**Violated invariant:** the small signing endpoint consumes only a bounded
application-level request body before JSON/base64 decoding.

**Root cause:** the handler used `await request.json()` without an application
size limit. Its signature rate limiter runs after parsing and message-policy
decoding, so it does not limit repeated oversized/invalid authenticated bodies.

**Conditions and impact:** possession of the signer bearer token and ability
to submit large bodies. A caller can force unnecessary allocation/parse work
and impair the single custody process. Runtime/proxy HTTP ceilings may bound
the maximum size; their effective values and memory-exhaustion impact were
**Not machine-verified**. No unauthenticated signer-body DoS is claimed because
authentication precedes body reads.

**Counterchecks:** bearer checking is before parsing; legitimate signatures are
rate-limited; only one recognized Aegis agent-transfer instruction is signable.
Those controls do not bound malformed authenticated input consumption.

**Local validation:** `audit_1/security-regressions.mjs:198` supplies a bounded
fixture stream without `Content-Length`. The old handler read beyond the 8 KiB
test budget; the fixed handler stops on the third 4 KiB chunk, cancels and
unlocks the stream, returning 400. The test at
`audit_1/security-regressions.mjs:173` verifies a correctly signed Aegis message
in a JSON body exactly 8 KiB long, so valid signing remains functional.

**Variants and remediation:** reuse the supplied streaming `readLimitedText`
helper with an 8 KiB signer budget before JSON parsing. API JSON parsing already
had a pre-existing 64 KiB streaming bound in the supplied working tree; its
no-`Content-Length` cancellation property also passes the audit runner. That
pre-existing API remediation is not credited as a newly found unpatched issue.

**Verification status:** passing cancellation and exact-boundary signature
tests. Full HTTP server/proxy behavior and sustained load were not tested.

## Important rejected hypotheses / false-positive filtering

| Hypothesis | Disposition and supporting evidence |
|---|---|
| Any signer can spend a policy | Rejected: both agent handlers compare signer key to registered authority; owner mutators also bind owner seeds/`has_one`. Native and SPL lifecycle tests reject old/intruder keys. |
| Another executable can replace the System program | Rejected for the supplied Anchor 1.0.2 tree: existing wrapper and on-chain substitution tests pass. The actual cached `Program<System>` implementation checks address/executable. No conclusion is made about a different dependency version. |
| A fake token program or mixed token-program accounts can receive vault signing privilege | Rejected: two fixed IDs, common owner checks, pinned mint and vault authority checks; T8 rejects mixed/unknown programs. |
| Token-2022 mint data can masquerade as an extended token account | Rejected for the tested case: byte-165 account-type validation and token-program checks reject the substitution in T8. This is not a blanket proof for every extension. |
| Removing `allowed_mints` / `allowed_programs` checks enables arbitrary agent CPI | Rejected in this implementation: arbitrary swaps are not implemented; SOL uses a fixed System CPI and SPL uses the separate enforced `token_mint` envelope and fixed supported token programs. The stored vectors are documented future-swap fields. |
| Raising/lowering caps or rotating an agent resets spend | Rejected for the same asset/window: `update_policy` and `rotate_agent` retain counters; same-mint `configure_token` retains token spend. T10 and added sequence tests cover this. Changing mint is an owner-signed change to a different asset. |
| Unpause restores a revoked agent | Rejected: revocation zeroes authority; unpause does not restore the key. The 256-step sequence explicitly tests revoke → unpause → old-agent rejection → rotation. |
| Close permits a stranger to revive the old agent | Rejected for tested lifecycle: live reinitialization fails, close clears/removes accounts, owner recreation installs the explicitly supplied new key; the old key is rejected. |
| Transfer-fee tokens bypass source spending caps | Rejected under the documented debit-based policy: the CPI amount is the source debit; the recipient may receive less. No share-credit/solvency accounting assumes full recipient receipt. Fee-extension behavior itself was not comprehensively machine-tested. |
| CPI ordering alone proves reentrancy | Rejected: reviewed CPIs target fixed trusted system/token programs, no arbitrary remaining accounts are forwarded, and state writes are transactional. No concrete untrusted callback bypass was established. |
| The log's `u16` head wrap corrupts a 16-entry ring | Rejected: 65,536 is divisible by the fixed capacity 16; wrapping preserves the modulo index. This is a static bound argument, not a new long-run test. |
| A captured raw owner transaction can be freely altered through the relay | Rejected for reviewed paths: draft fingerprints bind built instructions, metas, payer and blockhash; on-chain owner signatures still apply. Priority-fee exceptions are explicitly allow-listed separately. |

## Informational / hardening observations

1. **Window semantics:** SOL/token limits use resettable, anchored 86,400-second
   windows, not an exact trailing-24-hour sum. Spending near adjacent window
   boundaries can approach two window allowances over a short interval.
   Source: `agent_transfer.rs:94`, `agent_transfer_spl.rs:281`. Describe this
   precisely in user-facing promises; if strict trailing-window spending is a
   requirement, it needs a different accounting design. This was not promoted
   to a cap-bypass finding because the reset rule is explicit in the protocol.
2. **Token issuer/extension trust:** an owner-approved mint may still carry
   freeze, permanent-delegate, fee, memo or hook behavior. The program does not
   comprehensively inspect extensions. Hooks needing extra accounts are not
   forwarded by this instruction and should fail closed. Token-2022 base-layout
   tests are not a full issuer/extension compatibility audit. Add explicit asset
   trust policy and extension-specific tests before broader support claims.
3. **Owner policy-edit concurrency:** whole-policy updates can restore older
   caps, pause flags or allow-lists when previously owner-signed drafts land out
   of order. Each still needs the owner signature, so this is not an agent-only
   privilege bypass. A robust solution needs on-chain expected revision/field-
   specific updates and migration planning, not only an off-chain preflight.
   Architecture documentation was corrected to avoid claiming only harmless
   allow-list loss is possible.
4. **Token teardown/recovery:** `close_policy` sweeps SOL, not SPL accounts.
   Reinitializing the same owner's policy restores the same vault authority;
   tokens are not necessarily irrecoverable. The application guard checks the
   currently configured mint's ATA, not every historical/non-ATA mint account.
   Inventory and an owner token-sweep/recovery path remain desirable. Full
   multi-mint recovery was not machine-verified.
5. **Shared custody blast radius:** the remote bearer credential reaches a
   shared agent key. Aegis bounds per-policy loss but does not require a fresh
   owner signature for each agent transfer. Per-owner/session agents, short
   expiries, durable signer logs and explicit recipient lists reduce correlated
   compromise risk; a rate limit is not owner-consent enforcement.
6. **Availability/resource follow-ups:** native Redis connection/command paths
   lack an explicit per-operation deadline in `nonceStore.ts`; connection retry
   behavior was not exercised. Actionable/unresolved proposals are retained by
   `compactState` and can accumulate beyond the thread bound. Availability
   budgets and open-proposal retention limits warrant dedicated tests.
7. **Build/CI and bootstrap hardening:** CI does not run SBF/LiteSVM enforcement,
   references floating Action tags and Bun `latest`. VM bootstrap executes an
   installer from the network and falls back from frozen to non-frozen dependency
   installation. Pin/review build inputs and include on-chain security tests in
   a suitably provisioned CI job. The script was read, never executed.
8. **Frontend and key storage:** browser-owned model keys are persisted in local
   storage, while CSP permits inline/eval scripts. This increases the consequence
   of any XSS, but **no XSS source-to-sink exploit was established**. Frontend
   security remains partial coverage, not a confirmed key-exfiltration finding.
9. **RPC parsing defense:** selected client readers deserialize pinned-address
   policy/log data without explicitly checking `account.owner` at the client
   boundary. On-chain Anchor constraints still enforce actual ownership; no
   attacker-controlled valid PDA-data forgery was established. Explicit client
   owner/type validation would improve RPC consistency checks.

## Needs verification

No additional speculative vulnerability is assigned a confirmed severity.
The following evidence remains **Not machine-verified**:

- Deployed program bytecode/source equivalence, upgrade authority and multisig
  controls, actual cluster feature activation and deployed mint authorities.
- Live shared PostgreSQL/Redis behavior across replicas, Redis eviction and
  retention guarantees, and configured production credentials. Service replay
  tests use real provider/auth code with isolated local storage seams.
- Full Token-2022 fee/hook/memo/confidential/permanent-delegate matrices and
  multi-mint owner recovery.
- True trailing-window business requirements versus the implemented anchored
  reset semantics; stale owner-draft UX/approval expectations.
- Sustained signer load, effective HTTP proxy/server caps and native Redis
  outage/reconnect timing.
- Current remote dependency advisory status and deployment infrastructure.

## Tests and analysis performed

Before remediation the initial eight-test Node security runner had **five
failures and three passes**. The failing properties were duplicate execution,
schedule resurrection, production nonce-store selection, signer stream budget
and unexpected-error redaction. The final expanded runner has **ten passes**.

Local on-chain tests exercise the actual built SBF program in LiteSVM, not a
handwritten Rust imitation of the handlers. The final Rust run has **nine test
functions passing**: one library test, two account-wrapper tests and six
enforcement tests. One enforcement test contains the existing T1–T10 scenario
gate. Added coverage:

- `enforcement.rs:193`: intruder update/configure/rotate/revoke/close/withdraw
  attempts and victim-state preservation.
- `enforcement.rs:291`: 256 deterministic native-transfer sequence steps,
  interleaving cap boundaries, rejection atomicity, window changes, owner
  updates, revoke/unpause and fresh-agent rotation against an independent budget
  model. This is bounded sequence testing, **not coverage-guided fuzzing**.
- `enforcement.rs:389`: token spend retained across revoke/rotation, old-agent
  rejection, retained daily cap and expiry-before-rollover atomicity.
- `enforcement.rs:464`: live reinitialization rejection, owner close/recreation,
  and old-agent invalidation after recreation.

The SBF artifact was rebuilt offline with the supplied lockfile. The installed
builder's default `v3` artifact was rejected by the provided LiteSVM loading
setup (`Instruction(InvalidAccountData)`). Explicit `--arch v0` restored a
working, source-built artifact whose SHA-256 exactly matched the initial
artifact:

```text
c8dd1e7920aed75f5efefa5ca8de1707a88b496afd5dc79fa63dd756758c4b50
```

This is a local build-target compatibility observation, not evidence of a
runtime vulnerability. No deployment or unrequested toolchain installation was
performed.

### Reproduction commands

Run from the repository root, with the supplied installed dependencies:

```sh
node --test audit_1/security-regressions.mjs

PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH" \
  NO_DNA=1 CARGO_NET_OFFLINE=true cargo-build-sbf --offline --arch v0 \
  --manifest-path aegis/programs/aegis/Cargo.toml -- --locked

NO_DNA=1 CARGO_NET_OFFLINE=true "$HOME/.cargo/bin/cargo" test \
  --manifest-path aegis/Cargo.toml --locked --offline --tests -- --nocapture

node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/typescript/bin/tsc --noEmit --incremental false -p sdk/tsconfig.json
git diff --check
```

The Node runner uses the already-installed `jiti` dependency to load the real
TypeScript modules and `node:test` for assertions. It does not pretend to run
the Bun suite. `validation.log` contains the final local regression, Rust,
ESLint, typecheck, whitespace and artifact-hash results.

### Validation limitations and non-passing checks

- `bun` and the Anchor CLI were not available on PATH or in the inspected
  executable locations. Consequently **the full Bun suite and Next production
  build were not machine-verified**. Equivalent targeted security properties
  were tested through Node, and app/SDK TypeScript plus full ESLint passed.
  The added normal Bun regression is typechecked but was not executed in Bun.
- Strict `cargo clippy --all-targets -- -D warnings` failed on pre-existing
  documentation-list indentation in `revoke_agent.rs:12` and macro-generated
  `diverging_sub_expression` diagnostics at `lib.rs:30`. These are not presented
  as security findings or silently suppressed. No unrelated source fix was made.
- Whole-file `rustfmt --check` reports pre-existing formatting differences in
  the enforcement file. New test sections were formatted without reformatting
  the supplied unrelated edits. A globally clean Rust formatting gate is not
  claimed.
- Semgrep, Trident and QED tooling were unavailable; no security scanner,
  mutation campaign, coverage-guided fuzzing campaign or theorem prover result
  is claimed. Manual dataflow review, bounded state sequences and regression
  tests were the verification methods actually performed.

## Scope coverage and remaining surfaces

The table is a domain-level coverage declaration, **not certification of all
1,446 skill checklist items or every known vector**. Item-level completion
counts were not established; no exhaustive checklist score is fabricated.

| Skill domains | Scope and completion evidence / gap |
|---|---|
| 01 Account validation | In scope: all production Rust account contexts and parsers inspected; wrapper, substitution, token confusion and cross-owner tests; extension matrix partial |
| 02 Access control | In scope: all ten instruction authorities inspected; native/SPL revoke/rotate/admin tests; deployed upgrade authority not inspected |
| 03 Arithmetic | In scope: checked spend/clock arithmetic, bounded lists/ring, rent and asset-unit separation inspected; boundary and sequence tests; no formal/exhaustive proof |
| 04 CPI/PDA | In scope: all program CPI sites and seed bindings inspected; fixed targets and token-source authority verified; no arbitrary remaining-account forwarding; full extension coverage partial |
| 05 Lifecycle | In scope: init/update/revoke/rotate/close/recreate and proposal/schedule lifecycle; added sequence and stale-write tests; multi-mint recovery partial |
| 06 Economic logic | In scope: spending envelopes, rollover, source-debit accounting and no implemented swaps; no AMM/lending/oracle-solvency integration present |
| 07 Program operations/governance | In scope, partial: source privileges and manifests inspected; deployed authorities/operations not verified |
| 08 TypeScript | In scope, partial: critical provider/auth/signer/client paths; root/SDK typechecks; no claim of reading every TypeScript file |
| 09 Backend | In scope, partial: persistence, signing, nonce/session/challenge, selected routes, input/error handling; four confirmed findings; live stores and all route failures untested |
| 10 Frontend | In scope, partial: CSP and selected browser credential/routing code; no full UI/XSS or browser audit |
| 11 Supply chain | In scope, partial: manifests/locks, pinned Anchor and CI/bootstrap source; remote version-matched advisories and transitive source audit not performed |
| 12 Secrets/custody | In scope, partial: scoped signer, session/draft HMAC and documented custody; no real secret files or external key stores inspected |
| 13 Deployment | In scope, partial: CI and bootstrap read-only; offline build target observed; no deployed infrastructure verification |
| 14 Python | Out of scope: no in-scope Python implementation identified |
| 15 General-language safety | In scope, partial: shell bootstrap static inspection only; never executed |
| 16 Verification/testing | In scope, partial: actual SBF and local Node regression evidence; no formal proof, mutation testing or long-running fuzzing |
| 17 Monitoring/response | In scope, partial: error/signing log paths inspected; retention, alerting and incident-response operation not verified |
| 18 Privacy/change management | In scope, partial: error/credential boundary observations; compliance/process claims not assessed |
| 19 AI-agent security | In scope, partial: model output remains proposal input, agent signer policy reviewed; no comprehensive prompt-injection/red-team campaign |
| 20 Off-chain Rust | Out of scope: no production off-chain Rust service identified; program tests are not an off-chain service |
| Known-vector corpus | Selective account/PDA/CPI/lifecycle/auth/replay/resource/error reasoning; complete per-vector verdict coverage not performed |

No production Rust `unsafe` blocks, FFI boundary, zero-copy representation,
threads, locks or async Rust implementation were found in the program-source
scan. The dependency graph and SVM runtime contain lower-level code outside this
manual Rust implementation review; absence of program-local `unsafe` is not a
claim that all transitive dependencies were memory-safety-audited.

## Remediation handoff

All four confirmed code fixes are present locally; no chain program/state-layout
change, commit, branch, push or deployment was made. Production must configure a
shared nonce store before these changes are released. A stale conversational
write may now surface HTTP 409 instead of silently overwriting state; handle
that by reloading/re-deciding and never blanket-retrying a money-moving action.

Before release, run the normal Bun suite and Next build in the intended runtime,
exercise production-like shared Redis/PostgreSQL failure/concurrency tests, and
obtain independent review of the state-persistence change. Keep the owner-edit
revision, Token-2022 trust/compatibility and deployment-attestation items on the
security backlog; they were not silently treated as remediated by this patch.
