# Praxis — Feature Inventory & Forward Roadmap

**Version:** 1.0 · **Date:** 2026-05-30 · **Branch:** `docs/architecture-diagrams`
**Companion docs:** [`STATUS.md`](../STATUS.md) (does it work — audited), [`praxis-product-capstone-spec.md`](../praxis-product-capstone-spec.md) (intended shape), [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md).

This document answers two product questions, not a correctness question:

1. **What can a user actually do today?** (Section 1 — grounded in code.)
2. **What is worth building next, ranked honestly by value vs. real cost?** (Section 2 — and Section 3, what we deliberately *won't* build.)

> **The thesis is the spine.** Praxis is a conversational agent that can act on your behalf and **cannot hurt you** — non-custodial, enforced on-chain, scoped + revocable, no financial advice. *The agent proposes; the chain disposes.* Every candidate below is judged against that thesis, not just value/effort. A flashy feature that fights the thesis is a **risk to flag**, not a win to ship.

---

## How to read the ratings

| Axis | Scale |
|---|---|
| **Value** | ●○○○○ (cosmetic) → ●●●●● (advances the core thesis & a real user need) |
| **Effort** | **XS** (hours, no new infra) · **S** (a day) · **M** (multi-day) · **L** (new instruction / CPI / model change) · **XL** (new program, new off-chain infra) — rated *with existing scaffolding factored in* |
| **Thesis-fit** | ✅✅ strengthens "can't hurt you" · ✅ neutral / orthogonal · ⚠️ tension — needs a guard · ❌ conflicts with the thesis |

Effort is rated from the **actual code**, not the feature name. Where a rating depends on something I inferred rather than confirmed in the repo, it is flagged **[inferred]**.

---

## Section 1 — Implemented today (the honest current surface)

What a real user can do *right now*. "Mock" vs "Live" matters because it changes what the user actually gets: **everything is walkable end-to-end on MOCK**; the live-API path is code-complete and unit-proven but **not yet exercised against a cluster** (per STATUS.md §0).

### The on-chain moat — Aegis (real, proven by LiteSVM tests)

| Capability | State | What the user gets | Evidence |
|---|---|---|---|
| **`agent_transfer` with full enforcement order** | ✅ Live + tested | A scoped agent key can move SOL from the vault *only* inside the envelope; the chain itself rejects anything outside it | `agent_transfer.rs:60-160` implements the exact §5 order; `cargo test` T1–T5 green |
| **Per-tx + daily caps, exact boundary** | ✅ Live + tested | "send 50 sol" with a 5 SOL cap is rejected **on-chain**, not by the backend | T1: `max ok, max+1→6003`; daily `+1→6004` |
| **Rolling 24h day-rollover** | ✅ Live + tested | Spent-today resets correctly across the real clock, no off-by-one | T2 uses real `Clock` sysvar warp; `==86400` boundary asserted |
| **Signer check (agent_authority)** | ✅ Live + tested | An intruder key cannot spend; owner withdraw stays unconstrained | T3: intruder→6000; owner withdraws 5× the per-tx cap |
| **Recipient allow-list** | ✅ Live + tested | If set, agent can only pay listed recipients | T5: allowed ok, non-allowed→6005 (`agent_transfer.rs:116`) |
| **`revoke_agent` kill switch** | ✅ Live + tested | One owner tx zeroes the session key + pauses; next agent action dies | T4; `revoke_agent.rs` |
| **`rotate_agent` (re-key)** | ✅ Live + wired | Owner swaps in a fresh session key and unpauses, from the dashboard | `rotate_agent.rs`; `PolicyDashboard.tsx:103` |
| **Session-key expiry** | ✅ Live + wired | Key auto-expires; owner can extend +7d from the UI | enforced `agent_transfer.rs:78`; UI `SessionCard` (`PolicyDashboard.tsx:106`) |
| **Owner: fund / withdraw / update_policy** | ✅ Live + tested | Owner controls funds and caps; withdraw is unconstrained (it's their money) | `has_one = owner` gating; T6 |
| **On-chain audit log (allowed actions)** | ✅ Live | A 32-entry on-chain ring buffer of allowed actions powers the activity feed | `state.rs:83-108` `ActionLog`; cap 32 (`constants.rs:20`) |

> **Money-path integrity:** integer base units end-to-end — `u64` + `checked_add` on-chain, `bigint`/decimal-string off-chain. No floats touch a value path (STATUS.md, confirmed in `agent_transfer.rs:103`).

### The agent + product surfaces (real layer, mock-vs-live noted)

| Capability | State | What the user gets | Evidence |
|---|---|---|---|
| **Conversational SOL send** | ✅ Mock · 🟡 Live | "send 0.5 sol to maya" → resolve, simulate, preview "within your limit", sign | `praxisServer.transferBlock`; `AegisClient.simulateAgentTransfer` |
| **Intent parsing (Claude tool-use)** | ✅ Real (unexercised) | NL → typed `ParsedAction`; ambiguity → clarify; unsupported handled | `server/agent/intent.ts`; local-regex fallback for offline demos |
| **Address book + ambiguity asks** | ✅ Real | Two "alex" entries force a clarifying question instead of a guess | `addressBook.ts`; fuzzy match |
| **Simulation-first preview + policy verdict** | ✅ Mock · 🟡 Live | Sees fees + the Aegis verdict ("4.5 SOL remaining") *before* signing | `AegisClient.simulateAgentTransfer:139-147` |
| **Read-only research (no advice)** | ✅ Real (live) · ✅ Mock (canned) | Volume/price/holders distilled; explicitly *no* buy/sell/hold | `server/agent/research.ts` (RPC + DexScreener) |
| **Policy dashboard** | ✅ Mock · 🟡 Live | Live spend meter, editable caps, allow-lists, session card, big red Revoke | `PolicyDashboard.tsx` + `RevokeDialog` |
| **Activity log (allow/reject + reason)** | ✅ Mock · 🟡 Live | Rejections rendered first-class with the on-chain reason code | `ActivityLog.tsx` |
| **Single swappable provider** | ✅ Real | Mock↔Remote is a one-line env switch; no scattered mock data | `ProviderContext.tsx`; `NEXT_PUBLIC_PRAXIS_PROVIDER` |

### What is *not* in the product today (so the inventory is honest)

- **No swaps.** `agent_swap` is **not in the program** (`lib.rs:8` declares it out of scope). The UI parses a swap to a **typed stub** that always blocks. Correctly stubbed — no half-built CPI.
- **No SPL/token transfers.** `agent_transfer` is **native SOL only** (`transferBlock` throws on non-SOL; `agent_transfer.rs` is a system-program transfer).
- **`allowed_programs` / `allowed_mints` are stored but never enforced on-chain.** They sit on `PolicyAccount` (`state.rs:48-54`), are editable, and decode into `PolicyView` — but no on-chain instruction reads them, because the only value path is a recipient-gated SOL transfer. They are **enforced only in the mock's agent-layer** swap check today.
- **Rejections are not a durable on-chain trail.** Only *allowed* actions persist (a failed `agent_transfer` reverts). Rejected rows are reconstructed in session memory; the on-chain `AgentActionRejected` events live in failed-tx logs that nothing currently historizes.

---

## Section 2 — What's next, prioritized

Three horizons. **Now** = protect the floor & demo that already exist (cheap, high-integrity). **Next** = deepen the on-chain moat where the data model is already paid for. **Later** = real v2, but it needs new infra or a model change — earn it after the moat is wired live.

### Ranked order (the call, plainly)

1. **Live-path dress rehearsal** *(Now)*
2. **Faithful swap allow-list in API mode** *(Now)*
3. **Honest rejection-audit copy** *(Now)*
4. **SPL/token `agent_transfer` + on-chain mint allow-list enforcement** *(Next)*
5. **`agent_swap` Jupiter CPI through Aegis** *(Next/Later — the headline stretch)*
6. **Scoped automation (DCA / recurring)** *(Later — the agent-economy wedge)*
7. **Durable on-chain rejection trail (indexer)** *(Later)*
8. **Delegated-authority / session-key model (SWIG-style)** *(Later — production evolution)*
9. **Power-user mode** *(Later — cheap polish, off-moat)*
10. **Team / shared treasury** *(Later — only if it stays agent-centric)*
11. **Cross-chain bridging** *(Flagged — agent path conflicts with the thesis)*

---

### NOW — protect the floor and the demo before building anything new

These are the STATUS.md fixes. They are cheap, and each one closes a place where the green is currently lying or the demo diverges from the pitch. **Do these before any new feature.**

| # | Candidate | Value | Effort | Thesis-fit | Rationale (grounded) |
|---|---|---|---|---|---|
| 1 | **Live-path dress rehearsal** (deploy localnet → init → fund → `praxis:demo` → UI flow) | ●●●●● | **S** | ✅✅ | This is the only thing that moves money-shots #1/#2/#4 from 🟡 to ✅. Everything is coded — `scripts/praxis-demo.ts` already does the send + over-cap + typed-error read; `package.json` has `praxis:demo`. It has **never touched a cluster** in the audit. Cost is setup (validator, keypairs, env), not code. *Proving the envelope holds on-chain IS the pitch.* |
| 2 | **Faithful swap allow-list in API mode** (port `checkSwapPolicy` into `swapStubBlock`) | ●●●●○ | **XS** | ✅✅ | Money-shot #3 ("the allow-list holds") is the *only* demo moment that diverges: mock rejects an unverified mint, but `praxisServer.swapStubBlock` (`praxisServer.ts:375`) ignores `allowed_mints` and always says "not implemented." The mock's `checkSwapPolicy` (`mock/intent.ts:369`) already reads `allowedPrograms`/`allowedMints` off `PolicyView` — the same shape the server has. **~20 lines, no CPI, no new data.** Highest value-per-effort item in the whole roadmap. |
| 3 | **Honest rejection-audit copy** | ●●●○○ | **XS** (copy) / **L** (real reconstruct) | ✅✅ | The Activity UI says "N rejected on-chain / auditable without trusting us," but rejected rows are session memory, not durable chain state (`state.rs:79-82`). **Honesty is part of the thesis** — overclaiming safety undermines it. Cheap fix: label non-persisted rows "rejected (this session)." The durable version is item 7. |
| — | **Dead-ternary cleanup** (`entry.kind === Transfer ? "transfer" : "transfer"`, `praxisServer.ts:84`) | ●○○○○ | **XS** | ✅ | Latent mislabel bug; fold into the Now batch. |

---

### NEXT — deepen the moat where the data model is already paid for

| # | Candidate | Value | Effort | Thesis-fit | Rationale (grounded) |
|---|---|---|---|---|---|
| 4 | **SPL/token `agent_transfer` + on-chain mint allow-list enforcement** | ●●●●● | **M** | ✅✅ | *The single best value/effort pick after the Now fixes.* Most real agent spend is USDC, not SOL — SOL-only is a product ceiling. A token-transfer instruction **reuses the entire enforcement order verbatim** (signer→paused→expiry→caps→rollover) and swaps the system-program CPI for an SPL-token CPI + ATA handling — a well-trodden path **[inferred: no token CPI exists in the repo yet, but the account model is standard]**. Crucially, a token transfer is the **first value path that touches a mint**, so it finally gives `allowed_mints` (already stored & sized, `state.rs:53`) something to enforce on-chain — making the mint allow-list *real* without the cost of Jupiter. **Dependencies:** none new; reuses existing PDAs and the enforcement handler. |
| 5 | **`agent_swap` Jupiter CPI through Aegis** | ●●●●○ | **XL** | ⚠️ (✅✅ only if caps enforced in-program) | The headline stretch and a genuine moat-extender — but the program has **zero swap scaffolding** (only the stub). Jupiter CPI is the hard one: CU limits, large account counts, route-account passing (spec §13 flags it medium-high risk). **Thesis guard, loud:** the program must enforce `mint_in/out ∈ allowed_mints` *and* `notional ≤ caps` **in-instruction** — if it trusts an off-chain quote or skips the cap on the swap path, it **silently breaks "can't hurt you."** Until this lands, item 2's agent-layer check is the honest enforcement point, and the spec's fallback (owner-signed Jupiter swap, unconstrained) stays correct. **Dependencies:** Jupiter integration; bundles `allowed_programs`/`allowed_mints` on-chain enforcement; ideally item 4 first (token plumbing). |

> **On "on-chain mint/program allow-list enforcement" as a standalone candidate:** it isn't really standalone. The lists are inert until an instruction *moves a mint or calls a program* — i.e. a token transfer (item 4) or a swap (item 5). The data model is done; the work is the value path. Bundle it into whichever of 4/5 ships first. Listing it alone would over-state its independence.

---

### LATER — real v2, but needs new infra or a model change

| # | Candidate | Value | Effort | Thesis-fit | Rationale (grounded) |
|---|---|---|---|---|---|
| 6 | **Scoped automation (DCA / recurring / conditional)** | ●●●●● | **L–XL** | ✅✅ (⚠️ conditional path) | This is the **agent-economy wedge** the spec names (§2): "deploy an agent that DCAs/rebalances *inside a safety envelope*." The session-key + caps + expiry scaffolding is the perfect substrate — the envelope already exists. The new cost is a **trigger**: an off-chain crank/scheduler that fires `agent_transfer`/`agent_swap` on a schedule, plus optional on-chain schedule state **[inferred: no scheduler exists in the repo]**. **Thesis guard:** keep triggers *mechanical* (time/amount). A "conditional on price" trigger drifts toward acting on market signals — keep it data-mechanical, never advice-driven (§12.iv). **Dependencies:** a crank; ideally item 4 (DCA usually buys a token). |
| 7 | **Durable on-chain rejection trail** | ●●●○○ | **L** | ✅✅ | Makes "auditable without trust" fully true for rejections, not just allowed actions. But it's architecturally thorny: a rejected `agent_transfer` *reverts*, so you cannot persist a rejected record in the failing instruction (`state.rs:79`). Honest path is an **off-chain indexer** that scans `getSignaturesForAddress` for `AgentActionRejected` events (already emitted, `agent_transfer.rs:49`) and historizes them — net-new infra. Low marginal value over the item-3 copy fix + the events that already exist. **Dependencies:** indexer service. |
| 8 | **Delegated-authority / session-key over the owner's own account (SWIG-style)** | ●●●●○ | **XL** | ✅✅ | The spec's explicitly-named **production evolution** (§5, §10). It removes the vault model's one honest weakness — funds sit in a program vault, not the user's main wallet. More "real" non-custodial. But it's a **second program design**: token delegation/approve semantics, fiddlier revocation (spec §13 calls this out), a new account model. Deliberately deferred for the capstone *as a maturity signal*, not a gap. **Dependencies:** redesign vault→delegate; SPL delegation. Earn it after the moat is proven live. |
| 9 | **Power-user mode** (command palette, saved prompts, per-asset defaults) | ●●○○○ | **S** | ✅ | Pure frontend; the provider/UI seam already supports it. Cheap retention polish but **off-moat** — doesn't touch the thesis. Fine as fill between deeper items; never ahead of them. **Dependencies:** none. |
| 10 | **Team / shared treasury** | ●●○○○ | **L** | ⚠️ | A named audience (§2), but it pulls toward **Squads/multisig territory that §11 explicitly differentiates away from** — Praxis's wedge is a policy engine for an *autonomous agent signer*, not human co-signers. Multi-owner roles + approvals are a new governance model. **Only build if it stays agent-centric** (caps for an agent doing operational spend on a shared vault), not if it becomes a worse multisig. **Dependencies:** owner→multi-owner model. |
| 11 | **Cross-chain bridging** | ●●○○○ | **XL** | ❌ (agent path) | Flashy, but it **fights the thesis on the agent path**: Aegis enforces on Solana by consensus — once funds bridge, the envelope **cannot follow them** to the destination chain. An agent that can bridge can route around every cap. The safety guarantee literally stops at the bridge. **If built at all, restrict bridging to an owner-signed, unconstrained action — never an `agent_*` instruction** — and say so. See Section 3. **Dependencies:** deBridge/Wormhole + a far-side enforcement story that does not exist. |

---

## Section 3 — Deliberately deferred or declined (the "won't do," and why)

A clear "won't do" is a maturity signal and prevents scope thrash. These are split into **declined (conflict with the thesis)** and **deferred (real, just not now)**.

### Declined — conflicts with the thesis

| Idea | Why it's declined |
|---|---|
| **Autonomous / auto-trading "risk mode" / strategy bot** | Directly violates §12.iv (no buy/sell/hold advice). The moment the agent acts on a market *opinion* rather than a user's explicit, scoped instruction, "the agent cannot hurt you" becomes "the agent decides for you." Scoped *mechanical* automation (item 6) is the line — autonomous trading is over it. |
| **Custodial or KYC-heavy onboarding** | Violates §12.i (non-custodial). The product's entire claim is that you never hand over your keys; the agent gets a scoped, revocable session key. A custodial path deletes the thesis. |
| **"Trade any mint" without the verified-set guard** | Violates §12.iii. Verified mints are the default *by design*; an unverified mint requires an eyes-open owner override and is never in the agent's allow-list. Loosening this to chase tokens turns the safety feature into a footgun. |
| **Cross-chain *agent* execution** (item 11, agent path) | The on-chain envelope is Solana-only. Letting an `agent_*` instruction move value off-chain is an un-enforceable hole. Bridging, if ever built, must be owner-signed only. |
| **Raising the bounded-Vec limits / unbounded allow-lists** | The `#[max_len]` caps (`constants.rs:15-17`) are a security/account-sizing invariant, not a limitation to relax. Unbounded growth is a DoS/rent footgun. Keep bounded. |

### Deferred — real, but not a near-term product surface

| Idea | Why deferred |
|---|---|
| **Billing / freemium as a product surface** | Adds no on-chain depth and doesn't serve the thesis; it's an operational concern, not a feature that makes the agent safer. Build the moat first; monetization is a later, separate conversation. |
| **Delegated-authority model** (item 8) | Genuinely the production evolution, but XL and explicitly scoped out of the capstone as a deliberate maturity call. Deferred, not declined. |
| **Live subscribe/poll refresh loop** | `subscribe` is a poll stub today (STATUS.md gap #4); fine for single-user demo. A real warm-cache channel is post-demo polish, not floor. |

---

## Appendix — claims I inferred vs. confirmed

- **Confirmed in code:** session-key expiry enforced + UI-wired; `rotate_agent` done + wired; `allowed_programs`/`allowed_mints` stored, sized, editable, but unenforced (no value path); recipient allow-list enforced; SOL-only transfer; swap absent (stub only); `ActionLog` stores allowed-only; rejections are events in failed-tx logs; the swap-allow-list fix reuses existing `PolicyView` data.
- **Inferred (flagged inline):** SPL-token transfer effort (**M**) — the enforcement handler reuses cleanly, but no token CPI exists in the repo yet, so the ATA/account plumbing is an estimate from the standard pattern. Jupiter CPI difficulty (**XL**) — drawn from spec §13 + the absence of *any* swap scaffolding, not from existing swap code. DCA/automation needing a new off-chain crank — inferred from the repo having no scheduler/cron component.
