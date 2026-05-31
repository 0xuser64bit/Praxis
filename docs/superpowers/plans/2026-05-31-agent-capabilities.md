# Agent Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two agent capabilities — answering questions about the user's Aegis policy (LLM-classified, server-rendered from real numbers) and saving off-chain contacts (per-wallet, durable, including compound "send X and save as Y") — with inline + toast feedback.

**Architecture:** Extend the single intent-tool schema with two new action kinds (`policy_question`, `save_contact`). A pure `policyExplainer` renders deterministic answers from `PolicyView`. Saved contacts persist in `StoredProviderState.contacts` and merge into the `AddressBook`. The agent never touches the on-chain allow-list. Save feedback uses a new `notice` AgentBlock plus a lightweight client toast.

**Tech Stack:** TypeScript, Next.js (App Router), Bun test, React, `@solana/web3.js`, `@praxis/shared`.

**Reference spec:** `docs/superpowers/specs/2026-05-31-agent-capabilities-design.md`

**Testing note:** `bun run test` runs `bun test server app/api signer` — **components are not unit-tested**. Server/shared logic is TDD'd with `bun test`; client rendering (MessageItem, Toast) is verified with `bun run build`.

---

## File Structure

- `shared/src/provider.ts` — add `notice` variant to `AgentBlock`.
- `server/provider/stateSerialization.ts` — add `contacts` to `StoredProviderState`, compact + normalize.
- `server/agent/addressBook.ts` — mutable entries, `add()`, pasted-address-matches-saved-contact.
- `server/agent/intent.ts` — `policy_question` + `save_contact` in the union, Gemini schema, `normalizeAction`, system prompt, deterministic fallback.
- `server/agent/policyExplainer.ts` — **new**, pure deterministic explainer.
- `server/provider/praxisServer.ts` — `StoreState.contacts`, constructor merge, dispatch + save handler, save-first ordering, persist contacts.
- `components/app/MessageItem.tsx` — render `notice` block.
- `components/app/Toast.tsx` — **new**, `ToastProvider` + `useToast`.
- `app/app/page.tsx` — mount `ToastProvider`.
- `components/app/Conversation.tsx` — fire toast on new `notice` blocks.
- Tests: `server/provider/__tests__/stateSerialization.test.ts` (new), `server/agent/__tests__/addressBook.test.ts` (new), `server/agent/__tests__/intent.test.ts` (new), `server/agent/__tests__/policyExplainer.test.ts` (new), `server/provider/__tests__/praxisServer.test.ts` (extend).

---

### Task 1: Add the `notice` AgentBlock variant

**Files:**
- Modify: `shared/src/provider.ts:147-151`

- [ ] **Step 1: Add the variant**

In `shared/src/provider.ts`, change the `AgentBlock` union:

```typescript
export type AgentBlock =
  | { type: "prose"; text: string }
  | { type: "clarify"; text: string; options: ClarifyOption[] }
  | { type: "proposal"; text: string; proposalId: string }
  | { type: "research"; text: string; data: ResearchData }
  | { type: "notice"; tone: "success" | "info"; text: string };
```

- [ ] **Step 2: Verify it type-checks**

Run: `bunx tsc --noEmit 2>&1 | grep -E "provider.ts|MessageItem" | head`
Expected: no NEW errors referencing `AgentBlock` exhaustiveness (the existing `MessageItem` switch has a `default: return null`, so it still compiles).

- [ ] **Step 3: Commit**

```bash
git add shared/src/provider.ts
git commit -m "feat(shared): add notice AgentBlock variant"
```

---

### Task 2: Persist saved contacts in provider state

**Files:**
- Modify: `server/provider/stateSerialization.ts:1-18, 29-52, 62-70`
- Test: `server/provider/__tests__/stateSerialization.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `server/provider/__tests__/stateSerialization.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { compactState, normalizeStoredState, type StoredProviderState } from "../stateSerialization";

const base: StoredProviderState = { threads: [], proposals: {}, activity: [], contacts: [] };

describe("stateSerialization contacts", () => {
  test("normalizeStoredState defaults contacts to [] when missing", () => {
    const out = normalizeStoredState({ threads: [], proposals: {}, activity: [] });
    expect(out?.contacts).toEqual([]);
  });

  test("normalizeStoredState keeps a contacts array", () => {
    const contacts = [{ label: "bp", name: "bp", address: "ALUMw7kSn9xn67suHr2ti21CXBQVNMuRk7uWSM1WuXEt" }];
    const out = normalizeStoredState({ ...base, contacts });
    expect(out?.contacts).toEqual(contacts);
  });

  test("compactState preserves contacts", () => {
    const contacts = [{ label: "bp", name: "bp", address: "ALUMw7kSn9xn67suHr2ti21CXBQVNMuRk7uWSM1WuXEt" }];
    expect(compactState({ ...base, contacts }).contacts).toEqual(contacts);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test server/provider/__tests__/stateSerialization.test.ts`
Expected: FAIL — `contacts` does not exist on `StoredProviderState` (type error / undefined).

- [ ] **Step 3: Add `contacts` to the interface and imports**

In `server/provider/stateSerialization.ts`, add `AddressBookEntry` to the import block (lines 1-6):

```typescript
import type {
  ActionProposal,
  ActivityEntry,
  AddressBookEntry,
  AgentBlock,
  Thread,
} from "@praxis/shared";
```

Change the interface (lines 14-18):

```typescript
export interface StoredProviderState {
  threads: Thread[];
  proposals: Record<string, ActionProposal>;
  activity: ActivityEntry[];
  contacts: AddressBookEntry[];
}
```

- [ ] **Step 4: Carry contacts through compact + normalize**

In `compactState`, change the return (line 51) to include contacts:

```typescript
  return { threads, proposals, activity, contacts: state.contacts ?? [] };
```

In `normalizeStoredState`, change the return (lines 65-69):

```typescript
  return {
    threads: Array.isArray(state.threads) ? state.threads : [],
    proposals: isRecord(state.proposals) ? state.proposals : {},
    activity: Array.isArray(state.activity) ? state.activity : [],
    contacts: Array.isArray(state.contacts) ? state.contacts : [],
  };
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `bun test server/provider/__tests__/stateSerialization.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/provider/stateSerialization.ts server/provider/__tests__/stateSerialization.test.ts
git commit -m "feat(state): persist saved contacts in provider state"
```

---

### Task 3: AddressBook merges saved contacts and matches pasted addresses

**Files:**
- Modify: `server/agent/addressBook.ts:9-65`
- Test: `server/agent/__tests__/addressBook.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `server/agent/__tests__/addressBook.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { AddressBook } from "../addressBook";

const ADDR = "ALUMw7kSn9xn67suHr2ti21CXBQVNMuRk7uWSM1WuXEt";
const ADDR2 = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

describe("AddressBook saved contacts", () => {
  test("add() upserts and is resolvable by label", () => {
    const book = new AddressBook([]);
    book.add({ label: "backpack", name: "backpack", address: ADDR });
    const r = book.resolve("backpack");
    expect(r.kind).toBe("exact");
    expect(r.kind === "exact" && r.entry.address).toBe(ADDR);
  });

  test("a pasted address that matches a saved contact resolves to that contact", () => {
    const book = new AddressBook([{ label: "backpack", name: "Backpack Wallet", address: ADDR }]);
    const r = book.resolve(ADDR);
    expect(r.kind === "exact" && r.entry.name).toBe("Backpack Wallet");
  });

  test("an unknown pasted address resolves as a one-off pasted address", () => {
    const book = new AddressBook([]);
    const r = book.resolve(ADDR2);
    expect(r.kind === "exact" && r.entry.label).toBe("pasted-address");
  });

  test("add() dedupes by address (newest label wins)", () => {
    const book = new AddressBook([{ label: "old", name: "old", address: ADDR }]);
    book.add({ label: "backpack", name: "backpack", address: ADDR });
    expect(book.all().filter((e) => e.address === ADDR)).toHaveLength(1);
    expect(book.resolve("backpack").kind).toBe("exact");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test server/agent/__tests__/addressBook.test.ts`
Expected: FAIL — `book.add is not a function`.

- [ ] **Step 3: Make entries mutable and add `add()`**

In `server/agent/addressBook.ts`, replace the class field and constructor (lines 9-10):

```typescript
export class AddressBook {
  private entries: AddressBookEntry[];

  constructor(entries: AddressBookEntry[]) {
    this.entries = [...entries];
  }

  /** Upsert a contact, deduping by address and label (newest wins, placed first). */
  add(entry: AddressBookEntry): void {
    this.entries = [
      entry,
      ...this.entries.filter((e) => e.address !== entry.address && e.label !== entry.label),
    ];
  }
```

(The rest of the class body stays. `all()` and `labelFor()` are unchanged.)

- [ ] **Step 4: Resolve a pasted address to a saved contact when one matches**

In `resolve()`, replace the `if (directAddress)` block (lines 25-35):

```typescript
    if (directAddress) {
      const base58 = directAddress.toBase58();
      const known = this.entries.find((entry) => entry.address === base58);
      if (known) return { kind: "exact", entry: known };
      return {
        kind: "exact",
        entry: {
          label: "pasted-address",
          name: "Pasted address",
          address: base58,
          note: "not saved in the address book",
        },
      };
    }
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `bun test server/agent/__tests__/addressBook.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add server/agent/addressBook.ts server/agent/__tests__/addressBook.test.ts
git commit -m "feat(addressbook): support runtime add + pasted-address contact match"
```

---

### Task 4: Intent schema — `policy_question` and `save_contact`

**Files:**
- Modify: `server/agent/intent.ts:10-27, 56-84, 91-100, 223-264, 302-337`
- Test: `server/agent/__tests__/intent.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `server/agent/__tests__/intent.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { parseIntentLocallyForDemo } from "../intent";

const ADDR = "ALUMw7kSn9xn67suHr2ti21CXBQVNMuRk7uWSM1WuXEt";

describe("deterministic parser — new intents", () => {
  test("standalone save", () => {
    const r = parseIntentLocallyForDemo(`save ${ADDR} as backpack`);
    expect(r.outcome).toBe("actions");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({
      kind: "save_contact",
      address: ADDR,
      label: "backpack",
    });
  });

  test("compound send + save", () => {
    const r = parseIntentLocallyForDemo(`send 0.1 sol to ${ADDR} and save this address as backpack`);
    expect(r.outcome).toBe("actions");
    if (r.outcome !== "actions") throw new Error("expected actions");
    expect(r.actions.map((a) => a.kind)).toEqual(["save_contact", "transfer"]);
    const transfer = r.actions.find((a) => a.kind === "transfer");
    const save = r.actions.find((a) => a.kind === "save_contact");
    expect(transfer && transfer.kind === "transfer" && transfer.recipient).toBe(ADDR);
    expect(save && save.kind === "save_contact" && save.address).toBe(ADDR);
    expect(save && save.kind === "save_contact" && save.label).toBe("backpack");
  });

  test("policy question — general", () => {
    const r = parseIntentLocallyForDemo("how does my policy keep me safe");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({ kind: "policy_question", topic: "general" });
  });

  test("policy question — expiry", () => {
    const r = parseIntentLocallyForDemo("when does my session expire");
    expect(r.outcome === "actions" && r.actions[0]).toEqual({ kind: "policy_question", topic: "expiry" });
  });

  test("plain send still works", () => {
    const r = parseIntentLocallyForDemo("send 0.5 sol to maya");
    expect(r.outcome === "actions" && r.actions[0].kind).toBe("transfer");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test server/agent/__tests__/intent.test.ts`
Expected: FAIL — parser returns `clarify` for the new phrasings.

- [ ] **Step 3: Extend the `ParsedAction` union**

In `server/agent/intent.ts`, add to the `ParsedAction` union (after the `swap_stub` member, line 27):

```typescript
  | {
      kind: "swap_stub";
      amountHuman: string;
      assetIn: string;
      assetOut: string;
    }
  | {
      kind: "policy_question";
      topic: "caps" | "expiry" | "allowlist" | "pause" | "general";
    }
  | {
      kind: "save_contact";
      label: string;
      address: string;
    };
```

- [ ] **Step 4: Extend the Gemini tool schema**

In `intentTool.input_schema`, update the action `kind` enum (line 57-60) and add fields (after `assetOut`, line 80):

```typescript
            kind: {
              type: "string",
              enum: ["transfer", "research", "swap_stub", "policy_question", "save_contact"],
            },
```

and within `properties` (alongside `assetIn`/`assetOut`):

```typescript
            assetIn: { type: "string" },
            assetOut: { type: "string" },
            topic: {
              type: "string",
              enum: ["caps", "expiry", "allowlist", "pause", "general"],
              description:
                "For policy_question: which aspect the user asked about; 'general' for an overall explanation.",
            },
            label: {
              type: "string",
              description: "For save_contact: the human alias to save the address under.",
            },
            address: {
              type: "string",
              description: "For save_contact: the base58 address to save.",
            },
```

- [ ] **Step 5: Extend the system prompt**

Replace `INTENT_SYSTEM_PROMPT` (lines 91-100):

```typescript
const INTENT_SYSTEM_PROMPT = [
  "You parse user text for Praxis, a Solana agent protected by Aegis.",
  "Return exactly one tool call.",
  "Supported actions: native SOL transfer, read-only token research, swap_stub, policy_question, and save_contact.",
  "Swaps are not executable yet; emit swap_stub, never pretend agent_swap exists.",
  "Never emit buy/sell/hold advice. Research is neutral data only.",
  "policy_question: when the user asks about their own policy, limits, caps, session expiry, pause state, allow-lists, or how Praxis keeps them safe. Pick the closest topic, or 'general'.",
  "save_contact: when the user asks to save/remember an address under a name. Extract the base58 address and the label separately.",
  "Decompose multi-step requests in order. 'send X to ADDR and save as LABEL' is TWO actions: a transfer (recipient = ADDR) and a save_contact (address = ADDR, label = LABEL). Never fold 'and save as ...' into the recipient.",
  "Handle misspellings, shorthand, slang, and multiple steps in order.",
  "If the amount, recipient, asset, token, or action is ambiguous, outcome must be clarify.",
  "Never guess. One clarifying question is safer than one wrong transaction.",
].join(" ");
```

- [ ] **Step 6: Teach the deterministic fallback parser**

In `parseIntentLocallyForDemo` (lines 223-264), replace the body up to the final `return` with:

```typescript
export function parseIntentLocallyForDemo(text: string): ParsedIntent {
  const cleaned = text.trim().replace(/\s+/g, " ");

  const send = cleaned.match(/^s(?:end|nd)\s+([0-9]+(?:\.[0-9]+)?)\s*([a-z0-9$]+)?\s+(?:to|2)\s+(.+)$/i);
  if (send) {
    const asset = (send[2] ?? "sol").replace(/^\$/, "").toUpperCase();
    const amountHuman = send[1];
    // "ADDR and save (this address) as LABEL" → transfer + save_contact.
    const saveTail = send[3].match(/^(.*?)\s+(?:and\s+)?save\s+(?:this\s+address\s+|it\s+|that\s+)?as\s+(.+)$/i);
    if (saveTail) {
      const address = saveTail[1].trim();
      const label = saveTail[2].trim().replace(/[.?!]+$/, "");
      return {
        outcome: "actions",
        actions: [
          { kind: "save_contact", address, label },
          { kind: "transfer", asset, amountHuman, recipient: address },
        ],
      };
    }
    return {
      outcome: "actions",
      actions: [{ kind: "transfer", asset, amountHuman, recipient: send[3].trim() }],
    };
  }

  const save = cleaned.match(/^save\s+(\S+)\s+as\s+(.+)$/i);
  if (save) {
    return {
      outcome: "actions",
      actions: [{ kind: "save_contact", address: save[1].trim(), label: save[2].trim().replace(/[.?!]+$/, "") }],
    };
  }

  const policyTopic = matchPolicyQuestion(cleaned);
  if (policyTopic) {
    return { outcome: "actions", actions: [{ kind: "policy_question", topic: policyTopic }] };
  }

  const swap = cleaned.match(/^swap\s+([0-9]+(?:\.[0-9]+)?)\s+([a-z0-9$]+)\s+(?:for|into|to)\s+([a-z0-9$]+)/i);
  if (swap) {
    return {
      outcome: "actions",
      actions: [{ kind: "swap_stub", amountHuman: swap[1], assetIn: swap[2], assetOut: swap[3] }],
    };
  }

  const researchToken = matchResearch(cleaned);
  if (researchToken) {
    return { outcome: "actions", actions: [{ kind: "research", token: researchToken }] };
  }

  return {
    outcome: "clarify",
    question: "Do you want to send SOL, research a token, save a contact, ask about your policy, or preview a swap stub?",
  };
}

/** Classify a policy question into a topic, or null if it isn't one. */
function matchPolicyQuestion(text: string): "caps" | "expiry" | "allowlist" | "pause" | "general" | null {
  const t = text.toLowerCase();
  if (/\bexpir|\bsession\b/.test(t)) return "expiry";
  if (/\bpaus/.test(t)) return "pause";
  if (/\ballow.?list|allowed (recipient|address|program)/.test(t)) return "allowlist";
  if (/\b(daily )?(limit|cap)\b|how much can/.test(t)) return "caps";
  if (/\bpolicy\b|keep me safe|how (does|do|am i).*safe|am i safe/.test(t)) return "general";
  return null;
}
```

- [ ] **Step 7: Handle the new kinds in `normalizeAction`**

In `normalizeAction` (before the final `throw`, line 336), add:

```typescript
  if (value.kind === "policy_question") {
    const allowed = ["caps", "expiry", "allowlist", "pause", "general"] as const;
    const topic = typeof value.topic === "string" && (allowed as readonly string[]).includes(value.topic)
      ? (value.topic as (typeof allowed)[number])
      : "general";
    return { kind: "policy_question", topic };
  }

  if (value.kind === "save_contact") {
    return {
      kind: "save_contact",
      label: readRequiredString(value.label, "label"),
      address: readRequiredString(value.address, "address"),
    };
  }
```

- [ ] **Step 8: Run the test to confirm it passes**

Run: `bun test server/agent/__tests__/intent.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add server/agent/intent.ts server/agent/__tests__/intent.test.ts
git commit -m "feat(intent): add policy_question and save_contact intents"
```

---

### Task 5: Deterministic policy explainer

**Files:**
- Create: `server/agent/policyExplainer.ts`
- Test: `server/agent/__tests__/policyExplainer.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `server/agent/__tests__/policyExplainer.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { explainPolicy } from "../policyExplainer";
import { policyFixture } from "../../testing/fixtures";

function text(blocks: ReturnType<typeof explainPolicy>): string {
  return blocks.map((b) => (b.type === "prose" ? b.text : "")).join("\n");
}

describe("explainPolicy", () => {
  const now = 1_900_000_000;

  test("general explanation includes per-tx cap and daily remaining", () => {
    const policy = policyFixture({ maxPerTx: 1_000_000_000n, dailyLimit: 5_000_000_000n, spentToday: 1_000_000_000n, expiryTs: now + 3600, paused: false });
    const out = text(explainPolicy(policy, now, "general"));
    expect(out).toContain("1"); // 1 SOL per-tx
    expect(out.toLowerCase()).toContain("per transaction");
    expect(out.toLowerCase()).toContain("remaining");
  });

  test("paused policy says transfers are paused", () => {
    const policy = policyFixture({ paused: true });
    const out = text(explainPolicy(policy, now, "general")).toLowerCase();
    expect(out).toContain("paused");
  });

  test("expired session is called out", () => {
    const policy = policyFixture({ expiryTs: now - 10 });
    const out = text(explainPolicy(policy, now, "expiry")).toLowerCase();
    expect(out).toContain("expired");
  });

  test("empty recipient allow-list says any recipient", () => {
    const policy = policyFixture({ allowedRecipients: [] });
    const out = text(explainPolicy(policy, now, "allowlist")).toLowerCase();
    expect(out).toContain("any recipient");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test server/agent/__tests__/policyExplainer.test.ts`
Expected: FAIL — module `../policyExplainer` not found.

- [ ] **Step 3: Implement the explainer**

Create `server/agent/policyExplainer.ts`:

```typescript
import type { AgentBlock, PolicyView } from "@praxis/shared";
import { formatSol } from "../units";

export type PolicyTopic = "caps" | "expiry" | "allowlist" | "pause" | "general";

const REVOKED_AGENT = "11111111111111111111111111111111";

/**
 * Render a plain-English, ACCURATE explanation of a policy from its real values.
 * Pure over (policy, now) so it is deterministic and unit-testable — the LLM only
 * classifies the question; this never invents a number.
 */
export function explainPolicy(policy: PolicyView, now: number, topic: PolicyTopic = "general"): AgentBlock[] {
  const prose = (text: string): AgentBlock => ({ type: "prose", text });

  const perTx = `${formatSol(policy.maxPerTx)} SOL per transaction`;
  const remaining = policy.dailyLimit > policy.spentToday ? policy.dailyLimit - policy.spentToday : 0n;
  const daily = `${formatSol(policy.dailyLimit)} SOL per day (${formatSol(remaining)} SOL remaining today)`;

  const expiry = describeExpiry(policy, now);
  const pause = policy.paused
    ? "Transfers are currently PAUSED — the agent cannot move funds until you unpause."
    : "Transfers are active (not paused).";
  const recipients = policy.allowedRecipients.length === 0
    ? "Any recipient is allowed (no recipient allow-list set)."
    : `${policy.allowedRecipients.length} allow-listed recipient(s) are enforced on-chain.`;

  switch (topic) {
    case "caps":
      return [prose(`Your spending caps: ${perTx}, and ${daily}. Aegis enforces both on-chain before any SOL leaves your vault.`)];
    case "expiry":
      return [prose(expiry)];
    case "pause":
      return [prose(pause)];
    case "allowlist":
      return [prose(recipients)];
    case "general":
    default:
      return [
        prose("Your Aegis policy is enforced on-chain — the agent can only act inside these limits, no matter what it's asked:"),
        prose(`• Per-transaction cap: ${perTx}.`),
        prose(`• Daily cap: ${daily}.`),
        prose(`• Session: ${expiry}`),
        prose(`• Recipients: ${recipients}`),
        prose(`• ${pause}`),
        prose("Because these run inside the program, a wrong or malicious instruction can't exceed them — that's what keeps you safe."),
      ];
  }
}

function describeExpiry(policy: PolicyView, now: number): string {
  if (policy.agentAuthority === REVOKED_AGENT) {
    return "The agent key has been revoked — no agent transfers are possible until you re-enable it.";
  }
  if (policy.expiryTs <= now) {
    return "Your agent session has EXPIRED — transfers are blocked until you refresh it.";
  }
  const secs = policy.expiryTs - now;
  const hours = Math.floor(secs / 3600);
  const rel = hours >= 1 ? `~${hours}h` : `~${Math.max(1, Math.floor(secs / 60))}m`;
  return `Your agent session is active and auto-expires in ${rel} (at unix ${policy.expiryTs}).`;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `bun test server/agent/__tests__/policyExplainer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/agent/policyExplainer.ts server/agent/__tests__/policyExplainer.test.ts
git commit -m "feat(agent): deterministic policy explainer"
```

---

### Task 6: Wire the new intents into the provider

**Files:**
- Modify: `server/provider/praxisServer.ts:46-52, 116-132, 445-449, 704-711` and `blocksForIntent` (lines 418-443)
- Test: `server/provider/__tests__/praxisServer.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `server/provider/__tests__/praxisServer.test.ts` (the imports for `AddressBook`-style entries are not needed; use the existing harness):

```typescript
describe("policy questions", () => {
  test("explains the policy from real numbers", async () => {
    const { provider } = build();
    const { threadId } = await provider.send(null, "how does my policy keep me safe");
    const msg = provider.getThread(threadId)!.messages.at(-1) as { blocks: Array<{ type: string; text?: string }> };
    const proseText = msg.blocks.filter((b) => b.type === "prose").map((b) => b.text).join("\n").toLowerCase();
    expect(proseText).toContain("per-transaction cap");
    expect(proseText).toContain("keeps you safe");
  });
});

describe("save contact", () => {
  const ADDR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

  test("saves a contact and confirms with a notice block", async () => {
    const { provider } = build();
    const { threadId } = await provider.send(null, `save ${ADDR} as backpack`);
    const msg = provider.getThread(threadId)!.messages.at(-1) as { blocks: Array<{ type: string }> };
    expect(msg.blocks.some((b) => b.type === "notice")).toBe(true);
    expect(provider.getAddressBook().some((e) => e.label === "backpack" && e.address === ADDR)).toBe(true);
  });

  test("compound send + save: saves the contact and previews the transfer", async () => {
    const { provider } = build();
    const { threadId } = await provider.send(null, `send 0.1 sol to ${ADDR} and save this address as backpack`);
    const blocks = (provider.getThread(threadId)!.messages.at(-1) as { blocks: Array<{ type: string }> }).blocks;
    expect(blocks.some((b) => b.type === "notice")).toBe(true);
    expect(blocks.some((b) => b.type === "proposal")).toBe(true);
    expect(provider.getAddressBook().some((e) => e.label === "backpack")).toBe(true);
  });

  test("rejects an invalid address with a clarify block, saves nothing", async () => {
    const { provider } = build();
    const { threadId } = await provider.send(null, "save not-an-address as oops");
    const blocks = (provider.getThread(threadId)!.messages.at(-1) as { blocks: Array<{ type: string }> }).blocks;
    expect(blocks.some((b) => b.type === "clarify")).toBe(true);
    expect(provider.getAddressBook().some((e) => e.label === "oops")).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `bun test server/provider/__tests__/praxisServer.test.ts`
Expected: FAIL — `save_contact`/`policy_question` not dispatched (falls into `swapStubBlock`) and `getAddressBook` has no saved entry.

- [ ] **Step 3: Add `contacts` to `StoreState`**

In `server/provider/praxisServer.ts`, add to the `StoreState` interface (line 49):

```typescript
interface StoreState {
  threads: Thread[];
  proposals: Record<string, ActionProposal>;
  activity: ActivityEntry[];
  contacts: AddressBookEntry[];
  policy?: PolicyView;
  thinking: Record<string, boolean>;
}
```

Ensure `AddressBookEntry` is imported from `@praxis/shared` at the top of the file (add it to the existing shared import list if absent).

- [ ] **Step 4: Merge saved contacts in the constructor**

Replace the address-book + state initialization in the constructor (around lines 124-131):

```typescript
    const savedContacts = initialState?.contacts ?? [];
    this.addressBook = new AddressBook([...savedContacts, ...config.addressBook]);
    this.ownerKey = ownerKeyForConfig(config);
    this.state = {
      threads: initialState?.threads.length ? initialState.threads : [welcomeThread(nowSeconds())],
      proposals: initialState?.proposals ?? {},
      activity: initialState?.activity ?? [],
      contacts: savedContacts,
      thinking: {},
    };
```

- [ ] **Step 5: Order save_contact before other actions, then dispatch**

In `blocksForIntent`, replace the action loop (lines 435-442):

```typescript
    const blocks: AgentBlock[] = [];
    let title: string | undefined;
    // Process save_contact first so a sibling transfer can resolve the freshly
    // saved label to a friendly name on its proposal card.
    const ordered = [...intent.actions].sort(
      (a, b) => (a.kind === "save_contact" ? -1 : 0) - (b.kind === "save_contact" ? -1 : 0),
    );
    for (const action of ordered) {
      const result = await this.blockForAction(action);
      blocks.push(...result.blocks);
      title ??= result.title;
    }
    return { blocks, title };
```

Replace `blockForAction` (lines 445-449):

```typescript
  private async blockForAction(action: ParsedAction): Promise<{ blocks: AgentBlock[]; title?: string }> {
    if (action.kind === "transfer") return this.transferBlock(action);
    if (action.kind === "research") return this.researchBlock(action.token);
    if (action.kind === "policy_question") return this.policyQuestionBlock(action.topic);
    if (action.kind === "save_contact") return this.saveContactBlock(action.label, action.address);
    return this.swapStubBlock(action);
  }
```

- [ ] **Step 6: Implement the two handlers**

Add these methods to the class (next to `transferBlock`). Add the import `import { explainPolicy } from "../agent/policyExplainer";` at the top:

```typescript
  private async policyQuestionBlock(
    topic: "caps" | "expiry" | "allowlist" | "pause" | "general",
  ): Promise<{ blocks: AgentBlock[]; title?: string }> {
    const policy = await this.ensurePolicy();
    if (!policy) {
      return {
        blocks: [{ type: "prose", text: "I can't read your policy right now. Make sure your wallet is connected and your policy is initialized." }],
      };
    }
    return { blocks: explainPolicy(policy, nowSeconds(), topic), title: "Your policy" };
  }

  private async saveContactBlock(
    label: string,
    address: string,
  ): Promise<{ blocks: AgentBlock[]; title?: string }> {
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(address);
    } catch {
      return {
        blocks: [{
          type: "clarify",
          text: `"${address}" is not a valid Solana address, so I didn't save it. Paste a base58 address and try again.`,
          options: [],
        }],
      };
    }
    const cleanLabel = label.trim();
    const entry = { label: cleanLabel.toLowerCase(), name: cleanLabel, address: pubkey.toBase58() };
    this.addressBook.add(entry);
    this.state.contacts = [entry, ...this.state.contacts.filter(
      (c) => c.address !== entry.address && c.label !== entry.label,
    )];
    const short = `${entry.address.slice(0, 4)}…${entry.address.slice(-4)}`;
    return {
      blocks: [{
        type: "notice",
        tone: "success",
        text: `Saved "${entry.name}" → ${short}. Rename or remove it in Policy → Address book.`,
      }],
    };
  }
```

(Persisting happens via `send`'s final `await this.commit()`.)

- [ ] **Step 7: Persist contacts**

In `persist()` (lines 704-710), add contacts to the stored document:

```typescript
  private async persist(): Promise<void> {
    const state: StoredProviderState = {
      threads: this.state.threads,
      proposals: this.state.proposals,
      activity: this.state.activity,
      contacts: this.state.contacts,
    };
    await this.repository.save(this.ownerKey, state);
  }
```

- [ ] **Step 8: Run the provider tests**

Run: `bun test server/provider/__tests__/praxisServer.test.ts`
Expected: PASS (existing + 4 new tests).

- [ ] **Step 9: Run the full server suite**

Run: `bun run test`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add server/provider/praxisServer.ts server/provider/__tests__/praxisServer.test.ts
git commit -m "feat(agent): dispatch policy_question + save_contact in the provider"
```

---

### Task 7: Render the `notice` block in the conversation

**Files:**
- Modify: `components/app/MessageItem.tsx:47-78`

- [ ] **Step 1: Add a `notice` case to the block switch**

In `components/app/MessageItem.tsx`, add before `default:` (line 78):

```tsx
            case "notice":
              return (
                <div
                  key={i}
                  className={`rounded-lg px-3 py-2 text-[13px] leading-[1.45] [border:0.5px_solid_var(--border)] ${
                    block.tone === "success"
                      ? "bg-[rgba(91,160,110,0.10)] text-[var(--success,#5BA06E)]"
                      : "bg-[var(--surface-2)] text-[var(--text-secondary)]"
                  }`}
                >
                  {block.text}
                </div>
              );
```

(Use the same `key` convention already present in the switch — match the existing map index variable name; if the existing cases use `key={block...}` or an index `i`, mirror it exactly.)

- [ ] **Step 2: Verify build + types**

Run: `bun run build`
Expected: build succeeds; no TypeScript error about `block.tone`/`block.text` (the discriminated union narrows in the `case "notice"`).

- [ ] **Step 3: Commit**

```bash
git add components/app/MessageItem.tsx
git commit -m "feat(ui): render notice agent block"
```

---

### Task 8: Toast on save

**Files:**
- Create: `components/app/Toast.tsx`
- Modify: `app/app/page.tsx`, `components/app/Conversation.tsx`

- [ ] **Step 1: Create the toast provider**

Create `components/app/Toast.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Toast = { id: number; tone: "success" | "info"; text: string };
type ToastApi = { toast: (text: string, tone?: "success" | "info") => void };

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback((text: string, tone: "success" | "info" = "success") => {
    const id = ++seq.current;
    setToasts((prev) => [...prev, { id, tone, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-[320px] rounded-lg px-3.5 py-2.5 text-[13px] leading-[1.4] shadow-lg [border:0.5px_solid_var(--border)] ${
              t.tone === "success"
                ? "bg-[rgba(91,160,110,0.14)] text-[var(--success,#5BA06E)]"
                : "bg-[var(--surface-2)] text-[var(--text-secondary)]"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}
```

- [ ] **Step 2: Mount `ToastProvider` in the app page**

In `app/app/page.tsx`, wrap the existing content with `<ToastProvider>` (inside `ProviderProvider` if that is here; otherwise wrap the top-level returned element). Example:

```tsx
import { ToastProvider } from "@/components/app/Toast";
// ...
export default function AppPage() {
  return (
    <ToastProvider>
      {/* existing AppShell / ProviderProvider tree unchanged */}
    </ToastProvider>
  );
}
```

(Keep the existing children exactly as they were; only add the wrapper. If `ProviderProvider` wraps here, put `ToastProvider` just inside it so `useToast` and `useProvider` are both available to `Conversation`.)

- [ ] **Step 3: Fire a toast when a new notice block arrives**

In `components/app/Conversation.tsx`, add the import and an effect. Near the existing hooks (after `thread` is obtained):

```tsx
import { useEffect, useRef } from "react";
import { useToast } from "./Toast";
// ...
  const { toast } = useToast();
  const toasted = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!thread) return;
    for (const m of thread.messages) {
      if (m.role !== "agent" || toasted.current.has(m.id)) continue;
      const notice = m.blocks.find((b) => b.type === "notice");
      if (notice && notice.type === "notice") {
        toasted.current.add(m.id);
        toast(notice.text, notice.tone);
      }
    }
  }, [thread, toast]);
```

(Place the `useEffect` before the `if (!thread) return null;` early return so hook order stays stable — guard with `if (!thread) return;` inside the effect as shown.)

- [ ] **Step 4: Verify build**

Run: `bun run build`
Expected: build succeeds, no type errors.

- [ ] **Step 5: Commit**

```bash
git add components/app/Toast.tsx app/app/page.tsx components/app/Conversation.tsx
git commit -m "feat(ui): toast on contact save"
```

---

### Task 9: Final verification

- [ ] **Step 1: Lint**

Run: `bun run lint`
Expected: no NEW errors (pre-existing `sdk/dist`, `sdk/test`, and `getConnection`/`PulseDot` warnings are unrelated).

- [ ] **Step 2: Full test suite**

Run: `bun run test`
Expected: all pass (including the new stateSerialization, addressBook, intent, policyExplainer, and provider tests).

- [ ] **Step 3: Production build**

Run: `bun run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke (optional, mock mode)**

Run: `NEXT_PUBLIC_PRAXIS_PROVIDER=mock bun run dev` and at `/app` confirm the UI compiles. (Note: the mock provider has its own intent parser and is out of scope; API mode is the real target.)

---

## Self-Review

**Spec coverage:**
- Policy Q&A (LLM-classified, deterministic answer) → Tasks 4, 5, 6. ✓
- `save_contact` + per-wallet persistence → Tasks 2, 3, 6. ✓
- Compound "send and save" → Tasks 4 (parser), 6 (ordering). ✓
- Merge env + saved contacts; pasted-address match → Task 3, Task 6 (constructor). ✓
- Inline `notice` block → Tasks 1, 7. ✓
- Toast → Task 8. ✓
- Offline parity (deterministic parser) → Task 4. ✓
- Trust boundary (off-chain only; never on-chain allow-list) → enforced by design: `save_contact` only touches `state.contacts` + `AddressBook`; no Aegis call. ✓
- Tests for each unit → Tasks 2-6. ✓

**Type consistency:** `policy_question` topic enum (`caps|expiry|allowlist|pause|general`) is identical in `intent.ts`, `policyExplainer.ts` (`PolicyTopic`), and the provider dispatch. `save_contact` fields (`label`, `address`) match across parser, `normalizeAction`, and `saveContactBlock`. `notice` block shape (`tone`, `text`) matches across `shared`, provider, `MessageItem`, and `Toast`. `StoredProviderState.contacts` / `StoreState.contacts` are `AddressBookEntry[]` everywhere.

**Placeholder scan:** No TBDs; every code step shows complete code. Two client tasks (7, 8) ask the implementer to mirror an existing `key=` convention and wrapper placement — these are concrete instructions about matching surrounding code, not deferred work.
