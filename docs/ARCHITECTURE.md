# Praxis — Visual Architecture (as built)

> **What this is.** A picture of the system that *actually ships in this repo* — not the
> idealized spec. Where the spec (`praxis-product-capstone-spec.md`) and the audit
> (`STATUS.md`) disagree, the audit wins, and the divergence is drawn, not hidden.
> Honesty is the product, so honesty is the point of these diagrams.
>
> **How it was verified.** Every box and arrow below was checked against a real file
> (cited inline as `path:line`). The Aegis program logic is unit-proven on LiteSVM
> (`bun run aegis:test` — 6/6 green); the live `TS → RPC → program` round-trip is
> code-complete but **has not been run against a cluster** in the audit, so anything that
> only happens over real RPC is marked *built-but-unverified-live*, never *live*.

---

## Legend — the encoding used in every diagram

The whole product is "delegated action without delegated trust," so the diagrams are
colour-coded by **where authority lives** and **how real the path is**.

| Encoding | Meaning |
|---|---|
| 🟩 **On-chain (authoritative)** | Enforced by the Aegis Anchor program / Solana consensus. Cannot be bypassed by compromising the LLM or backend. |
| 🟦 **Off-chain (convenience)** | Backend / frontend logic. Has **no signing power**; mirrors or previews the on-chain rule but is never the source of truth. |
| 🟧 **Owner authority (unconstrained)** | The owner key. Deposit, withdraw, change policy, revoke/rotate — no caps apply. |
| 🟪 **Agent session key (envelope-bound)** | The scoped signer. Can *only* call `agent_transfer`, and only within the policy. |
| ⬜ **Mock-only** | Behaviour that exists only in the in-memory mock provider (standalone demo). |
| 🟥 **Stubbed / deferred** | Intentionally not built (dashed border): `agent_swap` CPI, on-chain `allowed_programs`/`allowed_mints` enforcement, durable on-chain rejection records. |
| 🟨 **Solana base layer** | System Program / RPC the program builds on. |

Status shorthand used in text: **✅ live & verified** · **🟡 built, not run on a cluster** ·
**⬜ mock-only** · **🟥 stubbed**.

```mermaid
flowchart LR
  L1["On-chain · authoritative"]:::onchain
  L2["Off-chain · convenience<br/>(no signing power)"]:::offchain
  L3["Owner key · unconstrained"]:::owner
  L4["Agent session key · envelope-bound"]:::agent
  L5["Mock-only"]:::mock
  L6["Stubbed / deferred"]:::stub
  L7["Solana base layer"]:::base

  classDef onchain fill:#d5f5e3,stroke:#1e8449,color:#0b3d23;
  classDef offchain fill:#d6eaf8,stroke:#2471a3,color:#0b2a45;
  classDef owner fill:#fdebd0,stroke:#b9770e,color:#5b3a02;
  classDef agent fill:#e8daef,stroke:#7d3c98,color:#3a1d4a;
  classDef mock fill:#f2f3f4,stroke:#909497,color:#2c2c2c;
  classDef stub fill:#fadbd8,stroke:#c0392b,color:#5b1a12,stroke-dasharray:4 3;
  classDef base fill:#fef9e7,stroke:#b7950b,color:#4d3f02;
```

---

## 1. System architecture — the real layered system

The system is four layers: **three surfaces** → **one swappable provider seam** →
(in API mode) **the server agent layer + Aegis adapter** → **the Aegis program** →
**Solana**. The only thing with signing authority is the program. Everything above the
program is an *interpreter*; the program is the *executor*.

The dashed red **trust boundary** is the key idea: cross it from above with a malicious
prompt, a buggy parse, or a fully compromised backend, and the envelope still holds —
because enforcement lives *below* the boundary, on-chain.

```mermaid
flowchart TB
  subgraph FE["Frontend — 3 surfaces (components/app/AppShell.tsx:123)"]
    direction LR
    CV["💬 Conversation<br/>Conversation.tsx"]:::offchain
    PD["🛡 Policy dashboard<br/>PolicyDashboard.tsx + RevokeDialog"]:::offchain
    AL["📜 Activity log<br/>ActivityLog.tsx"]:::offchain
  end

  SEAM{{"PraxisProvider interface — the one seam<br/>shared/src/provider.ts · ProviderContext.tsx:32<br/>switch on NEXT_PUBLIC_PRAXIS_PROVIDER"}}:::offchain

  subgraph MOCKSIDE["mock mode (default)"]
    MOCK["MockPraxisProvider<br/>in-memory, rule-based intent<br/>mock/mockProvider.ts + mock/intent.ts"]:::mock
  end

  subgraph APISIDE["api mode (NEXT_PUBLIC_PRAXIS_PROVIDER=api)"]
    REMOTE["RemotePraxisProvider<br/>fetch + bigint revive<br/>remoteProvider.ts"]:::offchain
    ROUTES["18 routes /api/praxis/*<br/>auth: demo token + same-origin<br/>server/api/json.ts:125"]:::offchain
    SRV["PraxisServerProvider (singleton)<br/>provider/praxisServer.ts"]:::offchain
  end

  subgraph AGENT["Server agent layer (off-chain — no signing power)"]
    direction LR
    INTENT["Intent parse → ParsedAction<br/>Claude tool-use OR local regex<br/>agent/intent.ts"]:::offchain
    BOOK["Address-book resolve<br/>exact / ambiguous / missing<br/>agent/addressBook.ts"]:::offchain
    POLICY["Policy mirror (preview only)<br/>agent/policy.ts:checkTransferPolicy"]:::offchain
    RESEARCH["Research (read-only)<br/>RPC + DexScreener<br/>agent/research.ts"]:::offchain
  end

  subgraph ADAPTER["On-chain adapter / codec (off-chain client)"]
    CLIENT["AegisClient<br/>build · simulate · send · confirm<br/>aegis/client.ts"]:::offchain
    CODEC["codec.ts / instructions.ts / pdas.ts<br/>hand-rolled borsh"]:::offchain
  end

  subgraph CHAIN["AEGIS — Anchor program (on-chain · THE MOAT)"]
    direction TB
    PA["PolicyAccount (PDA: 'policy'+owner)<br/>caps · spent_today · allow-lists · expiry · paused"]:::onchain
    VAULT["Vault (PDA: 'vault'+policy)<br/>SystemAccount custodies native SOL"]:::onchain
    LOG["ActionLog (PDA: 'action_log'+policy)<br/>ring buffer · ALLOWED actions only"]:::onchain
    IX["7 instructions<br/>owner: init/update/fund/withdraw/revoke/rotate<br/>agent: agent_transfer"]:::onchain
  end

  subgraph BASE["Solana base layer"]
    SYS["System Program<br/>(SOL transfer via CPI)"]:::base
    RPC["RPC / validator<br/>simulate · send · getAccountInfo"]:::base
  end

  SWAP["agent_swap (Jupiter CPI)<br/>NOT in the program — typed stub"]:::stub

  CV --> SEAM
  PD --> SEAM
  AL --> SEAM
  SEAM -.->|"mock"| MOCK
  SEAM -->|"api"| REMOTE
  REMOTE -->|"HTTP JSON<br/>bigint⇄decimal string"| ROUTES --> SRV
  SRV --> INTENT
  SRV --> BOOK
  SRV --> POLICY
  SRV --> RESEARCH
  SRV --> CLIENT
  CLIENT --> CODEC
  RESEARCH -.->|"read-only"| RPC
  CLIENT -->|"build + sign ix"| RPC
  RPC --> IX
  IX --> PA
  IX --> VAULT
  IX --> LOG
  VAULT -->|"CPI (only if policy passes)"| SYS
  IX -.->|"deferred"| SWAP

  TB1["⛔ TRUST BOUNDARY ⛔<br/>everything above is untrusted interpretation;<br/>enforcement lives below, on-chain"]:::boundary
  CLIENT --- TB1
  TB1 --- RPC

  classDef onchain fill:#d5f5e3,stroke:#1e8449,color:#0b3d23;
  classDef offchain fill:#d6eaf8,stroke:#2471a3,color:#0b2a45;
  classDef mock fill:#f2f3f4,stroke:#909497,color:#2c2c2c;
  classDef stub fill:#fadbd8,stroke:#c0392b,color:#5b1a12,stroke-dasharray:4 3;
  classDef base fill:#fef9e7,stroke:#b7950b,color:#4d3f02;
  classDef boundary fill:#fff,stroke:#c0392b,color:#c0392b,stroke-width:2px,stroke-dasharray:6 4;
```

**Reading notes (verified):**
- The mock side is a *complete second implementation* of `PraxisProvider`, not a fixture —
  it runs its own rule-based intent parser and its own policy check
  (`mock/intent.ts`, `mock/policy.ts`). It never touches the network. **All five demo
  moments are walkable on mock today.**
- In API mode the client holds the **agent keypair** and signs `agent_transfer`; it holds
  the **owner keypair** too in this demo build (see §3 honesty note). The program does not
  care who holds the keys — it checks the *signer* on-chain.
- `allowed_programs` / `allowed_mints` are **stored** on `PolicyAccount` but **not enforced
  by `agent_transfer`** (`state.rs:32-36`). Only the *recipient* allow-list is enforced
  on-chain. The mint allow-list is an off-chain agent-layer check (see §4b / §4e).

---

## 2. Aegis enforcement sequence — the moat, in exact order

This is the pitch. An `agent_transfer(amount)` arrives at the program and runs the spec
§5 gate **in this exact order** (`agent_transfer.rs:60-160`). Each gate has its own typed
error (codes `6000–6006`), and on rejection the program emits `AgentActionRejected` and
returns `Err`, which **reverts all account state** — so a rejection is *never* written to
the on-chain `ActionLog` (it lives only in the failed tx's logs). Boundary cases are
inclusive: `amount == max_per_tx` and `spent_today + amount == daily_limit` are **allowed**.

```mermaid
flowchart TD
  START(["agent_transfer(amount)<br/>signer = some key"]):::agent

  G1{"1 · signer == policy.agent_authority?<br/>agent_transfer.rs:68"}:::onchain
  G2{"2a · !paused?"}:::onchain
  G3{"2b · now < expiry_ts?"}:::onchain
  G4{"3 · amount ≤ max_per_tx?<br/>(== is allowed)"}:::onchain
  ROLL["4 · day rollover<br/>if now ≥ day_start_ts+86400:<br/>spent_today=0; day_start_ts=now"]:::onchain
  G5{"5 · spent_today + amount ≤ daily_limit?<br/>checked_add (== is allowed)"}:::onchain
  G6{"6 · allowed_recipients empty<br/>OR recipient ∈ list?"}:::onchain
  OPV{"op · vault.lamports() ≥ amount?<br/>(operational, not a policy reject)"}:::onchain

  E1["❌ UnauthorizedAgent · 6000"]:::stub
  E2["❌ PolicyPaused · 6001"]:::stub
  E3["❌ SessionExpired · 6002"]:::stub
  E4["❌ ExceedsPerTxLimit · 6003"]:::stub
  E5["❌ ExceedsDailyLimit · 6004<br/>(or MathOverflow · 6006)"]:::stub
  E6["❌ RecipientNotAllowed · 6005"]:::stub
  EOP["❌ InsufficientVaultBalance · 6011"]:::stub

  REJECT["emit AgentActionRejected{reason,…}<br/>return Err → ALL state reverts<br/>⚠ not persisted to ActionLog"]:::offchain

  subgraph PASS["✅ Allowed path (state commits)"]
    direction TB
    P1["spent_today += amount"]:::onchain
    P2["CPI: System Program transfer<br/>vault → recipient (vault PDA signs)"]:::base
    P3["action_log.push(ActionRecord{ALLOWED})"]:::onchain
    P4["emit AgentActionAllowed{amount,target,spent_today}"]:::onchain
    P1 --> P2 --> P3 --> P4
  end

  START --> G1
  G1 -->|no| E1
  G1 -->|yes| G2
  G2 -->|no| E2
  G2 -->|yes| G3
  G3 -->|no| E3
  G3 -->|yes| G4
  G4 -->|no| E4
  G4 -->|yes| ROLL --> G5
  G5 -->|no| E5
  G5 -->|yes| G6
  G6 -->|no| E6
  G6 -->|yes| OPV
  OPV -->|no| EOP
  OPV -->|yes| PASS

  E1 --> REJECT
  E2 --> REJECT
  E3 --> REJECT
  E4 --> REJECT
  E5 --> REJECT
  E6 --> REJECT
  EOP --> REJECT

  classDef onchain fill:#d5f5e3,stroke:#1e8449,color:#0b3d23;
  classDef offchain fill:#d6eaf8,stroke:#2471a3,color:#0b2a45;
  classDef agent fill:#e8daef,stroke:#7d3c98,color:#3a1d4a;
  classDef stub fill:#fadbd8,stroke:#c0392b,color:#5b1a12;
  classDef base fill:#fef9e7,stroke:#b7950b,color:#4d3f02;
```

**Verified facts:** the order, the inclusive boundaries, the `checked_add` overflow guard,
and the "rejections revert and are not logged on-chain" property are all in
`agent_transfer.rs` and `state.rs:75-95`. The five non-negotiable test scenarios
(over-cap, exact boundary, intruder signer, revoke, allow-list) pass on a clean rebuild
(`STATUS.md` T1–T6). The error codes are mirrored to TypeScript in
`server/aegis/constants.ts:43` and `shared/src/types.ts:35`.

---

## 3. Trust & authority boundary — who can do what

Two keys, one program. The **owner** is unconstrained; the **agent** is envelope-bound and
can call exactly one instruction. The vault custodies only native SOL. Revoke kills the
agent at the very first gate.

```mermaid
flowchart LR
  subgraph OWNERZONE["🟧 OWNER — unconstrained (has_one = owner)"]
    OWNER(["Owner key"]):::owner
    OI["initialize_policy"]:::owner
    OU["update_policy<br/>(caps · allow-lists · expiry · paused)"]:::owner
    OF["fund_vault"]:::owner
    OW["withdraw_vault<br/>NO caps — it's the owner's money<br/>withdraw_vault.rs"]:::owner
    OR["revoke_agent<br/>zero agent_authority + pause"]:::owner
    ORO["rotate_agent(new_key)"]:::owner
  end

  subgraph AGENTZONE["🟪 AGENT — envelope-bound"]
    AGENT(["Agent session key"]):::agent
    AT["agent_transfer(amount)<br/>— the ONLY instruction it may call —<br/>passes through all 7 §5 gates"]:::agent
  end

  subgraph PROG["🟩 Aegis program state (on-chain)"]
    PA["PolicyAccount<br/>owner · agent_authority · caps<br/>spent_today · allow-lists · expiry · paused"]:::onchain
    VAULT["Vault (PDA) — custodies native SOL ONLY"]:::onchain
    LOG["ActionLog — allowed actions, auditable"]:::onchain
  end

  REVOKED(["After revoke:<br/>agent_authority = 11111…1111 (default)<br/>paused = true"]):::stub

  OWNER --> OI & OU & OF & OW & OR & ORO
  OI --> PA
  OU --> PA
  OF --> VAULT
  OW -->|"unconstrained"| VAULT
  OR --> REVOKED
  ORO --> PA

  AGENT --> AT
  AT -->|"gate 1: signer == agent_authority"| PA
  AT -->|"on pass only"| VAULT
  AT --> LOG

  REVOKED -.->|"next agent_transfer<br/>old key ≠ authority → 6000"| AT

  classDef owner fill:#fdebd0,stroke:#b9770e,color:#5b3a02;
  classDef agent fill:#e8daef,stroke:#7d3c98,color:#3a1d4a;
  classDef onchain fill:#d5f5e3,stroke:#1e8449,color:#0b3d23;
  classDef stub fill:#fadbd8,stroke:#c0392b,color:#5b1a12,stroke-dasharray:4 3;
```

**What revoke/rotate kills (verified `revoke_agent.rs` + STATUS T4):** revoke zeroes
`agent_authority` to the default pubkey *and* pauses. The next `agent_transfer` from the
old key fails at **gate 1** (signer ≠ authority → `6000`) — it doesn't even reach the
pause check. One owner tx, instant, on-chain.

> ### ⚠️ Honesty note — key custody in *this* build
> The spec's manifesto says "won't hold your keys / non-custodial to the owner." That is
> the **production goal, not the current build.** Today the **server holds both the agent
> keypair and the owner keypair** (`server/env.ts:99-101`,
> `requireOwnerKeypair`/`requireAgentKeypair`); owner mutations (revoke, update, fund,
> withdraw) are signed server-side. There is **no wallet adapter** wired. API-mode
> mutations are gated only by a shared **demo token + same-origin** check
> (`server/api/json.ts:125`). So in the live demo the trust boundary protects against a
> *compromised LLM/parse*, but **not** against a compromised backend that holds the owner
> key. Wallet/session auth is the documented production gap (`STATUS.md §5`).

---

## 4. User journeys — the §9 demo moments, end to end

Each flow runs `input → intent → resolution → simulate → policy verdict → sign/confirm or
reject → activity log`. Where **mock and live API diverge**, the divergence is drawn.

### 4a. Successful send to a saved name — "within your limit" ✅ mock / 🟡 live

`send 0.5 sol to maya` → resolves Maya → simulates → passes the policy → signs → confirms.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant FE as Conversation (UI)
  participant P as Provider
  participant AG as Intent + AddressBook (off-chain)
  participant CL as AegisClient (off-chain)
  participant AE as Aegis program (on-chain)

  U->>FE: "send 0.5 sol to maya"
  FE->>P: send(threadId, text)
  P->>AG: parse intent → transfer{0.5 SOL, "maya"}
  AG->>AG: resolve "maya" → EXACT (Maya Patel)
  P->>CL: simulateAgentTransfer(maya, 0.5e9)
  CL->>AE: simulateTransaction(agent_transfer)
  Note over CL,AE: off-chain mirror (policy.ts) + on-chain sim agree:<br/>allowed · "within 5 SOL daily; 4.5 remaining after"
  AE-->>CL: sim ok
  CL-->>P: PolicyCheckResult{allowed:true}
  P-->>FE: ProposalCard (pending, green PolicyCheckBanner)
  U->>FE: Sign
  FE->>P: signProposal(id)
  P->>CL: executeAgentTransfer(maya, 0.5e9)
  CL->>AE: send agent_transfer
  AE->>AE: 7 gates pass → spent_today += 0.5 → CPI vault→Maya → log ALLOWED
  AE-->>CL: confirmed (sig)
  CL-->>P: status "confirmed"
  P-->>FE: Proposal "signed" + Activity row ALLOWED (on-chain)
```

### 4b. Over-cap send the chain rejects — "the chain says no" ✅ mock / 🟡 live

`send 50 sol to maya`. With the seed envelope (`max_per_tx = 50`, `daily_limit = 5`,
`spent_today = 0`), 50 SOL **passes** the per-tx gate (50 ≤ 50) and **fails the daily
gate** → typed `ExceedsDailyLimit (6004)`. The agent wanted to; the chain wouldn't.
(`scripts/praxis-demo.ts` lands this failing tx with `skipPreflight` to read the real
on-chain error; `seed.ts:82` / demo policy confirm the numbers.)

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant FE as Conversation (UI)
  participant P as Provider
  participant CL as AegisClient
  participant AE as Aegis program (on-chain)

  U->>FE: "send 50 sol to maya"
  FE->>P: send(...)
  Note over P: intent parses fine, Maya resolves EXACT
  P->>CL: simulateAgentTransfer(maya, 50e9)
  CL->>AE: simulateTransaction
  AE-->>CL: Custom(6004) ExceedsDailyLimit
  CL-->>P: PolicyCheckResult{allowed:false, reasonCode:OverDaily}
  P-->>FE: ProposalCard "blocked" + reason<br/>+ Activity row REJECTED (this session)
  Note over U,AE: Live demo (praxis-demo.ts) also *executes* it with skipPreflight<br/>so the failed tx + typed error are real on-chain artifacts.
```

> **Honesty:** gate 50 SOL is rejected by **OverDaily (6004)**, not OverPerTx — because the
> per-tx cap (50) is generous and the *daily* cap (5) is the binding constraint in the
> seed. The rejected Activity row is reconstructed from the typed error and held in
> **session memory**; it is *not* a durable on-chain record (rejections revert — see §2).

### 4c. Owner revokes → next agent action dies at the signer check ✅ mock / 🟡 live

```mermaid
sequenceDiagram
  autonumber
  actor O as Owner
  participant PD as Policy dashboard
  participant P as Provider
  participant CL as AegisClient
  participant AE as Aegis program (on-chain)
  actor U as User (later)

  O->>PD: Revoke agent (RevokeDialog)
  PD->>P: revokeAgent()
  P->>CL: revokeAgent()  (signed by OWNER key)
  CL->>AE: revoke_agent
  AE->>AE: agent_authority = default · paused = true
  AE-->>CL: confirmed
  P-->>PD: "Agent revoked" banner (header pill flips red)
  U->>P: "send 0.5 sol to maya"
  P->>CL: executeAgentTransfer(...)
  CL->>AE: agent_transfer (old agent key signs)
  AE-->>CL: ❌ Gate 1: signer ≠ agent_authority → UnauthorizedAgent (6000)
  CL-->>P: rejected{reasonCode:Unauthorized}
  P-->>U: blocked — "the session key is dead. You're never not in control."
```

### 4d. Ambiguous name → the agent asks instead of guessing ✅ both

`send 1 sol to alex` — two saved "alex" contacts (Kim & Stone, `seed.ts:57` /
`env.ts:31`). Resolution returns `ambiguous`; the agent renders a **clarify** block with
chips and **never builds a transaction** until disambiguated (spec §12.ii).

```mermaid
flowchart LR
  IN["“send 1 sol to alex”"]:::offchain
  R{"addressBook.resolve('alex')<br/>addressBook.ts:21"}:::offchain
  AMB["ambiguous → clarify block<br/>chips: Alex Kim · Alex Stone<br/>NO proposal built"]:::offchain
  PICK["User taps a chip →<br/>'send 1 sol to alex kim'"]:::offchain
  EXACT["resolve → EXACT → proceed to 4a"]:::offchain
  IN --> R -->|"2 matches"| AMB --> PICK --> R
  R -->|"missing → ask for address"| MISS["missing → 'paste the address'"]:::offchain
  R -.->|"1 match"| EXACT
  classDef offchain fill:#d6eaf8,stroke:#2471a3,color:#0b2a45;
```

### 4e. Read-only research → data, no advice ✅ both (real RPC live)

`what's bonk doing this week` → distilled on-chain + market data, explicitly **no
buy/sell/hold call** (spec §12.iv). Live: real RPC (`getTokenLargestAccounts`,
`getTokenSupply`) + DexScreener (`agent/research.ts`). Mock: canned (`mock/intent.ts:433`).
**Zero signing path — never touches the program or a key.**

```mermaid
flowchart LR
  Q["“what's bonk doing this week”"]:::offchain
  I["intent → research{token:'bonk'}"]:::offchain
  subgraph RO["read-only (no signing power)"]
    L["live: RPC + DexScreener"]:::offchain
    M["mock: canned ResearchData"]:::mock
  end
  CARD["ResearchCard: metrics + neutral summary<br/>“Data only — no buy/sell/hold calls.”"]:::offchain
  Q --> I --> RO --> CARD
  classDef offchain fill:#d6eaf8,stroke:#2471a3,color:#0b2a45;
  classDef mock fill:#f2f3f4,stroke:#909497,color:#2c2c2c;
```

### 4f. The swap allow-list — where mock and live genuinely DIVERGE 🟥

The spec's §9 #3 money-shot ("swap into an unverified mint → allow-list rejects") behaves
**differently** on mock vs live, and `agent_swap` is **not on-chain at all**.

```mermaid
flowchart TB
  IN["“swap 100 usdc into [unverified mint]”"]:::offchain
  SPLIT{"provider mode?"}:::offchain

  subgraph MOCKPATH["⬜ MOCK — sells the moat"]
    MC["checkSwapPolicy (mock/intent.ts:369)<br/>real check: Jupiter ∈ allowed_programs?<br/>mint ∈ allowed_mints?"]:::mock
    MR["❌ 'mint not in verified set'<br/>(agent-layer verdict, no on-chain code)"]:::mock
  end

  subgraph APIPATH["🟡 LIVE API — diverges"]
    SC["swapStubBlock (praxisServer.ts:375)<br/>IGNORES allowed_mints"]:::offchain
    SR["❌ 'agent_swap is a typed stub'<br/>NOT 'the allow-list holds'"]:::stub
  end

  ONCHAIN["🟥 agent_swap CPI into Jupiter<br/>NOT in the program (lib.rs:8)<br/>allowed_programs/allowed_mints NOT enforced on-chain"]:::stub

  IN --> SPLIT
  SPLIT -.->|"mock"| MC --> MR
  SPLIT -->|"api"| SC --> SR
  MR -.-> ONCHAIN
  SR -.-> ONCHAIN

  classDef offchain fill:#d6eaf8,stroke:#2471a3,color:#0b2a45;
  classDef mock fill:#f2f3f4,stroke:#909497,color:#2c2c2c;
  classDef stub fill:#fadbd8,stroke:#c0392b,color:#5b1a12,stroke-dasharray:4 3;
```

> **Two honest caveats on this one moment:**
> 1. **Even on mock, the mint allow-list is an *off-chain* (agent-layer) check** — there is
>    no on-chain `RejectReason` for it. The only allow-list `agent_transfer` enforces
>    on-chain is the **recipient** list. So "the chain rejects an unverified mint" is the
>    spec's aspiration; the *built* truth is "the agent layer rejects it, and `agent_swap`
>    isn't on-chain yet."
> 2. **Live API does not reproduce the mock behaviour.** `swapStubBlock` returns "not
>    implemented" and never runs `allowed_mints`. To make #3 faithful in API mode, the
>    server would run the same `checkSwapPolicy` before the stub message (`STATUS.md §3.1`,
>    ~20 lines). Until then, a judge running API mode sees a different result than the mock.

---

## 5. The provider seam — one interface, two backends

`PraxisProvider` (`shared/src/provider.ts`) is the *entire* contract between the UI and its
data. The UI imports the interface and the shared types — never a concrete implementation.
`ProviderContext.tsx` is the **single swap point**: one env var picks the in-memory mock or
the HTTP-backed remote. Both sides agree by construction because they share
`@praxis/shared` types, and money crosses the wire under one rule.

```mermaid
flowchart TB
  subgraph CONTRACT["@praxis/shared — the contract both sides import"]
    direction LR
    IFACE["PraxisProvider interface<br/>getPolicy/getActivity/getThreads/…<br/>send · signProposal · revokeAgent · …"]:::offchain
    TYPES["types.ts + provider.ts<br/>PolicyView · ActionProposal · PolicyCheckResult<br/>RejectReason (mirrors on-chain u8)"]:::offchain
    MONEY["MONEY RULE: BaseUnits = bigint in memory,<br/>decimal string on the wire (serde.ts)"]:::offchain
  end

  UI["3 surfaces via useStore()<br/>useSyncExternalStore(subscribe, getVersion)"]:::offchain
  SWITCH{{"ProviderContext.tsx:32<br/>NEXT_PUBLIC_PRAXIS_PROVIDER === 'api' ?"}}:::offchain

  subgraph MOCKIMPL["⬜ MockPraxisProvider — implements PraxisProvider"]
    MSEED["mock/seed.ts (in-memory state)"]:::mock
    MINTENT["mock/intent.ts (rule-based)"]:::mock
    MPOL["mock/policy.ts (same check shape)"]:::mock
  end

  subgraph REMOTEIMPL["🟡 RemotePraxisProvider — implements PraxisProvider"]
    RP["remoteProvider.ts<br/>fetch → /api/praxis/* · toWire/fromWire revive"]:::offchain
    SP["PraxisServerProvider — implements PraxisProvider<br/>(server side, behind the routes)"]:::offchain
  end

  REAL["Aegis program + RPC<br/>(authoritative)"]:::onchain

  UI --> IFACE
  IFACE -. typed by .-> TYPES
  TYPES --- MONEY
  IFACE --> SWITCH
  SWITCH -.->|"mock (default)"| MOCKIMPL
  SWITCH -->|"api"| REMOTEIMPL
  REMOTEIMPL --> SP --> REAL

  MARK["⭐ mock → live is ONE LINE here<br/>UI, types, and money rule never change"]:::owner
  SWITCH --- MARK

  classDef offchain fill:#d6eaf8,stroke:#2471a3,color:#0b2a45;
  classDef mock fill:#f2f3f4,stroke:#909497,color:#2c2c2c;
  classDef onchain fill:#d5f5e3,stroke:#1e8449,color:#0b3d23;
  classDef owner fill:#fdebd0,stroke:#b9770e,color:#5b3a02;
```

**Verified:** both `MockPraxisProvider` and `PraxisServerProvider` declare
`implements PraxisProvider`. The wire codec stringifies every `bigint` and the client
re-hydrates by money-key name (`remoteProvider.ts:227-265`, `server/api/json.ts:160`), so
type shapes agree by construction. The switch is genuinely one env-var line
(`ProviderContext.tsx:32`).

> **Seam caveats (`STATUS.md §3`):** API mode does **not** silently fall back to mock — a
> missing backend shows an error screen (`AppShell.tsx:42`), which is the honest choice.
> `subscribe` advertises a poll transport but the remote provider only refreshes **after a
> mutation** (no live polling loop). And API mode has real prerequisites not wired by
> default: deployed program, initialized policy, funded vault, owner+agent keypairs, RPC,
> and either `ANTHROPIC_API_KEY` or `PRAXIS_LOCAL_INTENT=1`.

---

## Appendix — what I inferred vs. confirmed

**Confirmed from code** (the overwhelming majority): every instruction, account, PDA seed,
the enforcement order and inclusive boundaries, error codes and their TS mirror, the
provider interface and its two implementations, the env-var swap point, the money/wire
rule, the address-book resolution outcomes, the swap stub, the owner+agent key custody, and
the demo-token/same-origin mutation gate.

**Inferred (not directly executed in this pass), flagged honestly:**
- The **live `TS → RPC → program` round-trip** is read-correct but **unverified against a
  cluster** — every 🟡 path (4a, 4b live, 4c, research live). The program itself is proven
  on LiteSVM only.
- In **4c**, that the post-revoke failure lands on **gate 1 (6000)** rather than the pause
  gate (6001) is inferred from the gate ordering (signer is checked before paused) and is
  corroborated by `STATUS.md` T4 ("old key → 6000"); not separately executed here.
- **Real Claude intent parsing** and **real DexScreener/RPC research responses** were not
  exercised (no API key / network in the audit); the request/response shapes look correct.
- The `refreshActivity` dead ternary (`praxisServer.ts:83`,
  `kind === Transfer ? "transfer" : "transfer"`) is a latent cosmetic bug noted in
  `STATUS.md §4.4`; harmless today because no swap kind is ever written on-chain.
