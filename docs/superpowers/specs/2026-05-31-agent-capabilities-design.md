# Agent capabilities: policy Q&A + save-to-address-book

Date: 2026-05-31
Status: approved (design)

## Problem

The Praxis agent only understands three intents — `transfer`, `research`,
`swap_stub`. Anything else falls through to `unsupported`, or gets mashed into a
transfer's `recipient` field. Two concrete failures motivated this:

1. **"how does my policy keep me safe"** — one of the four suggested prompts in
   `components/app/Composer.tsx`, yet there is no policy-question intent, so
   Gemini returns `unsupported`. The policy data needed to answer (caps, expiry,
   allow-lists, pause, spent-today) is already loaded server-side via
   `getPolicy()`; the agent simply has no way to talk about it.
2. **"send 0.1 SOL to 2xrv… and save this address as backpack"** — there is no
   "save contact" intent, *and* the address book is read-only (built from the
   `PRAXIS_ADDRESS_BOOK` env var only, `server/agent/addressBook.ts`). Gemini
   stuffed the whole tail ("2xrv… and save this address as backpack") into
   `recipient`, and resolution failed.

## Goals

- Answer questions about the user's own Aegis policy, accurately.
- Save off-chain contacts (per wallet, durable) by natural-language request,
  including compound "send X and save as Y".
- Give the user clear feedback when a contact is saved.

## Non-goals

- The agent never edits the **on-chain** recipient allow-list. That stays a
  wallet-signed owner action in the Policy UI. Saving a label is purely
  off-chain and carries no signing power.
- No new value-moving capabilities; swaps remain a typed stub.

## Approach

Extend the existing single intent-tool schema and add server-side handlers
(rather than a multi-tool router or regex pre-parsing). This reuses the existing
`actions[]` array, which is already multi-step capable, keeps one schema as the
single source of truth, and adds the least new surface.

### 1. Intent schema — two new action kinds (`server/agent/intent.ts`)

Add to the `ParsedAction` union, the Gemini function schema's `kind` enum, and
`normalizeAction`:

- `policy_question` with optional `topic: "caps" | "expiry" | "allowlist" | "pause" | "general"` (default `general`).
- `save_contact` with `label: string` and `address: string` (base58).

Because both live in the same `actions[]` array, compound requests compose
naturally (e.g. `[transfer, save_contact]`).

### 2. Policy explainer — deterministic (`server/agent/policyExplainer.ts`, new)

The LLM **classifies** the question (value-safe); the **answer** is built
server-side from real numbers — never LLM-phrased — so a safety explanation can
never state a wrong cap.

- Input: the loaded `PolicyView` (already has `maxPerTx`, `dailyLimit`,
  `spentToday`, `dayStartTs`, `expiryTs`, `paused`, `allowedRecipients`,
  `allowedPrograms`, `allowedMints`, `vaultBalance`, and the token-envelope
  fields) plus current chain time (`AegisClient.chainTime()`).
- Output: `AgentBlock[]` — a plain-English explanation plus the concrete values:
  per-tx cap, daily limit and **remaining today** (`dailyLimit - spentToday`),
  expiry (relative + absolute, or "expired"/"revoked"), pause state, and
  allow-list status ("any recipient allowed" when empty, else "N saved
  recipients enforced on-chain").
- `topic`-aware ordering: e.g. `expiry` leads with session expiry; `general`
  renders the full summary with a short "how this keeps you safe" framing.
- Pure function over `PolicyView` + `now` so it is unit-testable without a chain.

`blocksForIntent` in `server/provider/praxisServer.ts` dispatches
`policy_question` → `ensurePolicy()` + `chainTime()` → explainer blocks.

### 3. Address book — per-wallet persistence + save flow

- Add `contacts: AddressBookEntry[]` to `StoredProviderState`
  (`server/provider/stateSerialization.ts`), persisted in the same Postgres
  state as threads/proposals/activity. Update `compactState` and
  `normalizeStoredState` to carry/tolerate it.
- `AddressBook` (`server/agent/addressBook.ts`) resolves against **env defaults
  (`config.addressBook`) + saved contacts**, deduped by address (saved entries
  win on label collision).
- New provider handling for `save_contact`:
  - Validate the address (`new PublicKey(address)`); reject non-base58 with a
    clear clarify/error block.
  - Normalize the label (trim, lowercase for matching, keep display form).
  - Upsert into `state.contacts` (replace any entry with the same address or
    label), then `await commit()` (durable before responding).
  - Emit a `notice` block (see §5) confirming "Saved 'backpack' → 2xrv…4GeG —
    rename or remove it in Policy → Address book."
- **Save applies immediately, no confirm card.** Rationale: labels carry zero
  signing power, and every future send still shows the *resolved address* on the
  proposal card before signing, so a mistyped label can never cause a silent
  wrong transfer. Low friction, fully reversible via the address-book UI.
- `GET /api/praxis/get-address-book` already returns the merged list to the
  client.

### 4. Compound instructions + address extraction (system prompt)

Update `INTENT_SYSTEM_PROMPT` to:

- Separate a pasted base58 address from trailing directive words.
- Decompose "send X to ADDR **and save (it/this address) as** LABEL" into two
  actions: `transfer(recipient=ADDR)` and `save_contact(address=ADDR, label=LABEL)`.
- When the user says "save ADDR as LABEL" alone, emit a single `save_contact`.

Processing order in the provider: handle `save_contact` **before** the sibling
`transfer` so the transfer proposal renders with the new label. The transfer
still requires the normal sign step.

### 5. Save feedback — inline notice block + toast

A chat agent should leave a trace in the thread *and* nudge the user.

- New `AgentBlock` variant in `shared/src/provider.ts`:
  `{ type: "notice"; tone: "success" | "info"; text: string }`. Rendered inline
  in the conversation as a subtle confirmation row (new case in the message
  renderer). Persistent record of the save.
- A lightweight toast: a minimal `ToastProvider` + `useToast()` mounted at the
  app shell. The conversation surfaces a toast when a freshly-arrived agent
  message contains a `notice` block, deduped by message id (a `Set` of
  already-toasted message ids), auto-dismissing after ~4s. No backend coupling —
  the toast is driven entirely off the rendered reply.

### 6. Offline parity + tests

- Teach `parseIntentLocallyForDemo` (the deterministic, no-LLM fallback) the two
  new patterns: a policy-question matcher ("policy", "keep me safe", "my
  limit/cap", "expire", "paused") and a save matcher ("save ADDR as LABEL",
  "send … and save … as LABEL"). This keeps $0/offline demos working and gives
  the test suite an LLM-free path.
- Unit tests:
  - Intent normalization for `policy_question` and `save_contact`
    (missing/garbled fields rejected).
  - `policyExplainer` output across policy shapes: normal capped, expired
    session, revoked agent, paused, empty vs non-empty recipient allow-list,
    SPL-envelope configured vs not.
  - Address-book merge (env + saved), upsert/dedupe by address and label,
    invalid-address rejection.
  - Compound "send 0.1 SOL to ADDR and save as backpack" via the deterministic
    parser → exactly `[transfer, save_contact]` with the address shared.
  - `notice` block renders inline; toast fires once per message id.

### 7. Suggested prompts

The existing "how does my policy keep me safe" suggestion now works. Leave the
list as-is for now (optionally swap one stale swap example for a "save … as …"
example later — author's call, out of scope here).

## Trust boundary (explicit)

- The agent saves **off-chain labels only**. It never touches the on-chain
  recipient allow-list; "saved as backpack" ≠ "the agent may now send there
  freely." Aegis allow-list enforcement is separate and on-chain.
- The policy explainer is **read-only** explanation derived from on-chain policy
  — explanation, never enforcement.

## Files touched

- `server/agent/intent.ts` — schema, prompt, `normalizeAction`, deterministic fallback.
- `server/agent/policyExplainer.ts` — new, deterministic explainer.
- `server/agent/addressBook.ts` — merge env + saved contacts.
- `server/provider/stateSerialization.ts` — `contacts` in `StoredProviderState`.
- `server/provider/praxisServer.ts` — dispatch `policy_question` / `save_contact`, save handler.
- `shared/src/provider.ts` — `notice` `AgentBlock` variant.
- `components/app/*` — render `notice` block; minimal `ToastProvider` + `useToast`.
- Tests alongside the above.

## Out of scope / future

- LLM-phrased policy answers (deliberately rejected for accuracy).
- Editing on-chain allow-lists via natural language.
- Contact notes/enrichment, contact deletion via chat (UI handles removal).
