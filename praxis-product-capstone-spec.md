# Praxis — Definitive Product & Capstone Spec

**Working name:** Praxis *(keep it — it's good, and the manifesto framing is already strong)*
**One-liner:** A conversational agent for Solana that can act on your behalf — and *cannot* hurt you, because an on-chain policy engine enforces what it's allowed to do.
**Lane:** AI agents (mentor's explicitly blessed "a chat UI that works well with Solana is really good") — upgraded with the on-chain depth the rubric actually rewards.
**Optimized for:** winning a ranked top-20-of-200 cut in ~48h with AI doing the build, *and* being a real product afterward.

---

## 0. The decision this whole doc commits to (read first)

A conversational wallet, by itself, is a **consumer product whose hard parts live off-chain** — intent parsing (prompt engineering), routing (a Jupiter SDK call), simulation (an RPC call), signing (an existing wallet adapter). For a cut that explicitly judges *technical heaviness and on-chain depth*, that's the weak archetype the mentor warned about, and "AI agent for Solana" is the single most crowded idea in the room. As a chat-over-Jupiter, Praxis is middle-of-the-pack.

**The moat is the part you currently have on the roadmap as "scoped automation": an on-chain policy engine.**

> The agent proposes. The chain disposes.

You build a Solana program — codename **Aegis** — that holds the agent's spending envelope *on-chain* and rejects any action outside it. Max per transaction, max per day, allow-listed programs, allow-listed recipients, allow-listed mints, expiry, instant revoke. The agent is given a **scoped, revocable session key**; it physically cannot exceed the policy because the program won't sign off on the transaction. Safety is enforced by code, not by your backend's good behavior.

This single move does four things at once:
1. Puts the technical center of gravity **on-chain** (a real Anchor program judges can probe).
2. Makes the project **novel** — not "another agent that can transact," but "the agent that's safe to give transact power to."
3. Lets you **reuse your finished Praxis frontend** — your biggest 48h advantage.
4. Plays to your demonstrated strengths (product + agent orchestration) while still being deeply on-chain.

Everything below assumes this center. If you ever feel tempted to spend engine-time polishing the chat instead of hardening Aegis, that's the moment you slip back into the middle of the pack. **Aegis is the project. The chat is the demo.**

---

## 1. The core insight (the thing you say in the first 20 seconds)

Every AI-agent-with-a-wallet has the same unsolved problem: to be useful it needs signing power, but signing power means it can drain you — through a bug, a bad parse, a prompt injection, or a compromised backend. Today everyone "solves" this with a human-in-the-loop confirm on every action, which kills the entire point of an agent, or with backend-side limits, which are a promise, not a guarantee.

Praxis solves it the only way that actually holds: **the limits live in a Solana program.** The agent holds a key that is cryptographically scoped. When it tries to send 50 SOL but your daily cap is 5, the *chain* rejects the transaction. When it tries to route into an unverified mint, the *chain* rejects it. When you hit "revoke," the key is dead on-chain in one transaction. The agent operates inside an envelope it cannot cross, and the envelope is enforced by consensus, not by trust.

That's the product. That's the capstone. That's the demo money-shot.

---

## 2. Who it's for / why anyone cares

- **The crypto-native power user** who wants to type "swap 100 usdc for jup at best route" instead of hunting through tabs — but won't hand keys to a black box.
- **The agent-economy builder** (the real forward-looking wedge): anyone who wants to deploy an autonomous agent that pays for things, rebalances, or DCAs on-chain needs exactly this safety envelope. Praxis is the safe hands an agent acts through.
- **Teams / shared treasuries** that want an assistant that can execute small operational spends within hard caps, with a revoke switch and an on-chain audit trail.

The unifying need: **delegated on-chain action without delegated trust.**

---

## 3. Product surfaces

Three surfaces. You already have the first built.

### A. The conversation (have: Praxis frontend)
One input field. Natural language in, a verified signable action out. Multi-turn memory, address book, research queries, transaction previews with simulation results. This is your existing UI — wire it to the real engine.

### B. The policy dashboard (build: the new surface that sells the moat)
Where the owner sets and sees the agent's envelope: per-tx cap, daily cap, "spent today" live counter, allow-listed programs/recipients/mints, session-key expiry, and a big red **Revoke agent** button. This screen is what makes the safety story *visible* — judges need to see the envelope, not just be told about it.

### C. The activity log (build: the audit trail)
Every agent action, on-chain, with its policy check result: allowed, or rejected-and-why. This is the "you can audit it without trusting us" proof, and it doubles as the live demo feed.

---

## 4. Technical architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Praxis frontend (Next.js — you already have this)             │
│   • Conversation   • Policy dashboard   • Activity log          │
└───────────────┬────────────────────────────────────────────────┘
                │
        ┌───────▼─────────────────────────────────────┐
        │  Agent backend (TS)                          │
        │   • Intent parse (Claude → structured action)│
        │   • Executor: build tx routed THROUGH Aegis  │
        │   • Simulate against live state, return preview│
        │   • Research (read-only RPC + indexers)       │
        └───────┬───────────────────────┬───────────────┘
                │ builds + simulates     │ holds the scoped
                │                        │ session key (signs
                │                        │ agent actions)
        ┌───────▼────────────────────────▼──────────────┐
        │  AEGIS — on-chain policy engine (Anchor)       │  ← THE MOAT
        │   • PolicyAccount: the envelope                │
        │   • AgentVault: policy-governed funds          │
        │   • agent_transfer / agent_swap: checked CPIs  │
        │   • revoke / rotate / update_policy (owner)    │
        │   • on-chain enforcement: reject if out of bounds│
        └───────┬────────────────────────────────────────┘
                │ CPI (only if policy passes)
        ┌───────▼────────────────────────────────────────┐
        │  Jupiter (swaps) · SPL Token · System program    │
        └──────────────────────────────────────────────────┘
```

**The architectural line to repeat (it's already in your manifesto, now made literal):** the agent is the *interpreter*; the safety layer is the *executor* — and the executor is now an on-chain program. Compromise the LLM, compromise the backend, and the envelope still holds.

---

## 5. AEGIS — the on-chain policy engine (this is what judges probe; get it correct)

A program-owned smart wallet that custodies a slice of the user's funds and enforces a spending policy on every agent-initiated action. The **owner** key is unconstrained (deposit, withdraw, change policy, revoke). The **agent session key** is scoped and can only move funds within the policy.

### Why custody-in-a-vault for the demo (the design call I made)
Two models exist:
- **(chosen) AgentVault model:** owner funds a program-owned vault; agent spends from the vault within limits. Clean, self-contained, trivial to demo, and the enforcement logic is unambiguous. Downside: funds sit in the vault, not the owner's main wallet.
- **(alternative) Delegated-authority model:** policy governs a delegate/session key over the owner's own ATA (closer to SWIG / token delegation). More "real," but the enforcement and revocation semantics are fiddlier and easier for AI to get subtly wrong in 48h.

Build the **AgentVault model** for the capstone; mention the delegated-authority model as the production evolution. This is a deliberate maturity signal, not a shortcut — say so.

### Accounts
- **`PolicyAccount`** (PDA, seeded by `owner`)
  - `owner: Pubkey`
  - `agent_authority: Pubkey` — the registered session key (the agent's scoped signer)
  - `max_per_tx: u64`
  - `daily_limit: u64`
  - `spent_today: u64`
  - `day_start_ts: i64` — for the rolling-window reset
  - `allowed_programs: Vec<Pubkey>` — e.g. System, SPL Token, Jupiter
  - `allowed_recipients: Vec<Pubkey>` *(optional allow-list; empty = any)*
  - `allowed_mints: Vec<Pubkey>` *(for swaps; verified set)*
  - `expiry_ts: i64` — session key auto-expires
  - `paused: bool`
  - `bump: u8`
- **`AgentVault`** (PDA-owned token account(s), seeded by `policy`) — the USDC/SOL the agent may spend.
- **`ActionRecord`** (optional, PDA per action or a ring buffer) — on-chain audit log: `{ kind, amount, recipient_or_program, result, ts }`. Powers the activity feed and the "auditable without trust" claim.

### Instructions
1. `initialize_policy(limits)` — owner creates the policy and registers the agent session key.
2. `update_policy(limits)` — owner-only; adjust caps, allow-lists, expiry.
3. `fund_vault(amount)` / `withdraw_vault(amount)` — owner-only; withdraw is unconstrained (it's the owner's money).
4. `agent_transfer(recipient, amount)` — **agent-initiated.** Enforces, in order:
   - signer == `agent_authority`
   - `!paused` and `now < expiry_ts`
   - `amount <= max_per_tx`
   - day rollover: if `now >= day_start_ts + 86400`, reset `spent_today = 0`, `day_start_ts = now`
   - `spent_today + amount <= daily_limit`
   - if `allowed_recipients` non-empty: `recipient ∈ allowed_recipients`
   - on pass: `spent_today += amount`, CPI transfer from vault → recipient, write `ActionRecord{allowed}`
   - on fail: return a typed error (and optionally log `ActionRecord{rejected, reason}`)
5. `agent_swap(amount_in, min_out, route)` — **agent-initiated.** Enforces program ∈ `allowed_programs` (Jupiter), `mint_in`/`mint_out` ∈ `allowed_mints`, notional ≤ caps; then CPIs into Jupiter. *(This is the hard one — see build plan; it's a stretch, not the floor.)*
6. `revoke_agent()` — owner-only; zero the `agent_authority` / set `paused`. The kill switch. One tx, instant, on-chain.
7. `rotate_agent(new_key)` — owner-only; swap the session key.

### Events
`PolicyInitialized`, `PolicyUpdated`, `VaultFunded/Withdrawn`, `AgentActionAllowed { kind, amount, target }`, `AgentActionRejected { kind, reason }`, `AgentRevoked`.

> **AI failure modes to guard against (test these explicitly, don't trust "it compiles"):**
> - **Day-rollover math** — off-by-one on the 86400 window, or resetting on the wrong comparison. Test: spend up to cap, advance clock <24h → rejected; advance >24h → allowed again.
> - **Cap boundary** — `<=` vs `<` on `max_per_tx` and `daily_limit`. Test exact-boundary amounts.
> - **Signer check** — the single most important line. Test: a key that is NOT `agent_authority` calling `agent_transfer` → must reject. Test: owner can still `withdraw_vault` unconstrained.
> - **Revoke actually revokes** — after `revoke_agent`, the next `agent_transfer` from the old key fails. Test it.
> - **Allow-list bypass** — recipient/mint not in list → rejected.

These five test scenarios are the non-negotiable gates. They're also, conveniently, your demo.

---

## 6. The agent layer

- **Intent parsing:** Claude (you already credit `claude-sonnet-4.6` in the UI) with a tool/structured-output schema → a typed `ProposedAction { kind, params }`. Misspellings, slang, multi-step lines. Ambiguity → a clarifying question (your principle ii — keep it; it's correct and it's a safety feature).
- **Executor:** turns `ProposedAction` into a transaction **routed through Aegis** (never a raw transfer — that's the whole point), simulates against live state, returns the preview the UI already renders.
- **Simulation-first:** every action simulated before the user sees it; show outcome, fees, slippage, and — the new part — **the policy check result** ("within your 5 SOL daily limit; 4.5 remaining").
- **Research:** read-only. On-chain volume, price action, holder concentration via RPC + an indexer. Zero signing risk, easy floor feature, and it fills out the "conversational" story. Data only, never advice (your principle iv).

---

## 7. Full product feature set (vision + when it ships)

| Capability | What it does | Ships |
|---|---|---|
| Conversational send | "send 0.5 sol to maya" → resolve, preview, sign | Capstone floor |
| **On-chain policy envelope (Aegis)** | per-tx / daily caps, allow-lists, expiry, enforced on-chain | **Capstone floor — the moat** |
| **Revoke / rotate agent key** | instant on-chain kill switch | **Capstone floor** |
| Policy dashboard | set limits, live "spent today", revoke button | Capstone floor |
| On-chain activity log | every agent action + allow/reject reason | Capstone floor |
| Simulation-first previews | outcome, fees, slippage, **policy check** before signing | Capstone floor |
| Research, distilled | volume, price, holders, summarized; never advice | Capstone hook (easy) |
| Address book | aliases / .sol / history-derived, ambiguity asks | Capstone hook |
| Agent-routed swaps via Jupiter | "swap 100 usdc for jup" within policy | Capstone stretch |
| Scoped automation | DCA, conditional, recurring — inside session-key limits | Post-capstone (v2) |
| Cross-chain | bridge via deBridge / Wormhole, routes compared | Post-capstone (v2) |
| Power-user mode | command palette, saved prompts, per-asset defaults | Post-capstone |

---

## 8. The 48-hour winning build (engine-first, high floor, AI-executable)

Hand each block to the agent; gate each on its tests before advancing.

**H0–6 · Aegis scaffold + the core check.** Anchor init on localnet. `PolicyAccount`, `AgentVault`, `initialize_policy`, `fund_vault`, `withdraw_vault`, `agent_transfer` with the full check list. *Gate: the five §5 test scenarios pass — over-cap rejected, exact-boundary correct, non-agent signer rejected, owner withdraw unconstrained.*

**H6–14 · Harden the moat.** `revoke_agent`, `rotate_agent`, `update_policy`, day-rollover correctness, `ActionRecord` logging, events. *Gate: revoke kills the next agent action; day-rollover resets correctly across a simulated clock advance.* **At the end of this block you have the novel, defensible, technically-heavy core. This is your submittable floor even if nothing below lands.**

**H14–22 · Agent layer + send flow end-to-end.** Claude intent parse → `ProposedAction` → executor builds an `agent_transfer` through Aegis → simulate → preview → sign → confirm. Wire to the existing Praxis conversation UI. *Gate: "send 0.5 sol to maya" works on localnet/devnet through the program; "send [over-cap]" is rejected by the chain and the UI shows why.*

**H22–30 · (Stretch) agent-routed swaps.** `agent_swap` CPI into Jupiter with mint/notional checks. *If the Jupiter CPI fights you — and it might; CU and account-count limits are real — fall back: the agent proposes a normal Jupiter swap the **owner** signs directly (unconstrained), and agent-routed swaps become a documented v2. Do not sink the floor for this.*

**H30–40 · The surfaces that sell it.** Policy dashboard (set limits, live "spent today", **Revoke** button) and the on-chain activity log/feed, both wired to real program state and events. Research query (read-only) for the conversational completeness.

**H40–46 · Demo polish.** Rehearse the money-shots (§9). Make the rejection visible and legible — the rejected transaction and its on-chain reason are the star, so surface them beautifully.

**H46–48 · Demo video + README + narrative.** Record the flow. Write the "agent proposes, chain disposes / safe-by-construction" story (§10).

---

## 9. Demo script (the money-shots, in order)

1. **It works.** "send 0.5 sol to maya" → resolves Maya from the address book, previews with simulation + "within your daily limit," sign, confirms in <1s. *Establishes the agent is real.*
2. **The chain says no.** "send 50 sol to maya" → agent parses it fine, builds the tx — and **Aegis rejects it on-chain: exceeds 5 SOL daily limit.** Show the failed instruction and the reason. *This is the moment. The agent wanted to; the chain wouldn't let it.*
3. **The allow-list holds.** "swap 100 usdc into [unverified mint]" → rejected: mint not in the verified set. *Safety isn't just amounts.*
4. **The kill switch.** Owner clicks **Revoke agent** (one on-chain tx). Next agent action fails — the session key is dead. *You're never not in control.*
5. **The read-only flourish.** "what's bonk doing this week" → distilled on-chain data, no advice. *Rounds out the conversational product.*

Five actions, maybe ninety seconds, and every one of them demonstrates the moat rather than the wrapper.

---

## 10. Submission narrative (what to say to judges)

- "Everyone's building agents that *can* transact. The unsolved problem is making that **safe**. We built the part that makes it safe — and we put it **on-chain**."
- "Praxis is a conversational agent, but the capstone is **Aegis**: a Solana program that holds the agent's spending envelope and enforces it at the program level. Per-tx caps, daily caps, allow-listed programs and mints, expiry, instant revoke."
- "Compromise our LLM, compromise our backend, inject a malicious prompt — **the envelope still holds**, because it's enforced by consensus, not by our code's good behavior. The agent is the interpreter; the on-chain program is the executor."
- "We chose a custodial vault model for the demo because the enforcement semantics are unambiguous; the production path is delegated authority via session keys over the user's own account (SWIG-style). That's a deliberate scoping decision." *(maturity)*
- Walk the **day-rollover, the signer check, and the revoke** as the three places this is easy to get subtly wrong — and show the tests that prove you didn't. *(depth — judges love seeing the failure modes you anticipated)*

---

## 11. Differentiation

| Compared to | They do | Praxis wins by |
|---|---|---|
| Raw wallets (Phantom etc.) | hold keys, manual clicking | natural-language intent + an agent that can act for you |
| Other "AI agents for Solana" | parse intent, then sign with full power | **on-chain enforced limits** — agent power without agent trust |
| Squads / multisig | human co-signers, treasury governance | a policy engine designed for an **autonomous agent** signer, not humans |
| Backend-enforced limits | a promise in your server | a guarantee in a Solana program |

The defensible wedge is the combination: a finished conversational UX **plus** an on-chain policy engine that's the actual product. The first is table stakes; the second is the moat.

---

## 12. What Praxis won't do (keep your manifesto — it's a maturity signal)

1. **Won't hold your keys.** Non-custodial to the owner; the agent gets a scoped, revocable session key, never your seed.
2. **Won't guess.** Ambiguity prompts a clarifying question. One extra question beats one wrong transaction.
3. **Won't chase every token.** Verified mints by default; unverified requires an eyes-open override *and* isn't in the agent's allow-list.
4. **Won't pretend to be your advisor.** Surfaces data, executes verified actions. No buy/sell/hold calls.
5. **Won't hide fees.** Network, swap, and protocol fees surfaced before signing.

These aren't just principles — items 1, 3, and 4 are now **enforced by Aegis**, which is the point. The manifesto stops being marketing and becomes the spec.

---

## 13. Risks & honest mitigations

- **Aegis correctness (highest risk).** AI writes plausible-but-wrong enforcement (day rollover, boundary, signer). Mitigation: the §5 test scenarios are hard gates; they're also the demo, so you're forced to prove them.
- **Jupiter CPI (medium).** Agent-routed swaps may exceed CU/account limits. Mitigation: it's a stretch, not the floor; fallback is owner-signed swaps.
- **Session-key model scope (medium).** Building a full SWIG-style delegated-authority system in 48h is too much. Mitigation: the vault model is self-contained and fully demonstrates enforcement; delegated authority is the documented v2.
- **"It's just an LLM tool-call" skepticism (perception).** Judges may discount the agent. Mitigation: lead with Aegis, not the chat. The chat is how you *show* the program; the program is what you're *submitting*.
- **Idea thrash (real, given the last two days).** Mitigation: this is the commit. The finished frontend + the on-chain moat is your strongest *and* most efficient path. Build it.

---

## 14. Scope lines

- **Floor (must have):** Aegis with `agent_transfer` + full enforcement + revoke/rotate + tests; agent send flow wired to the Praxis UI; policy dashboard; activity log. *This alone is a novel, technically-heavy, on-chain capstone.*
- **Hook (target):** research queries + address book + the polished rejection/kill-switch demo. *This is what makes it memorable in the room.*
- **Stretch (upside only):** agent-routed Jupiter swaps through Aegis. *Never at the cost of the floor.*

---

*Build Aegis first and prove the five enforcement tests before you wire a single line of the agent to it. The chain rejecting an over-limit agent action is the entire pitch — everything else is the frame around that one moment.*
