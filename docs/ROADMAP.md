# Praxis Roadmap

Updated: 2026-05-30

This roadmap describes the product that actually exists in this repository after
the hardening pass. It intentionally does not count mock-only or marketing-only
behavior as shipped.

## Implemented

- Conversational sends for native SOL and one configured SPL token.
- Aegis Anchor program with on-chain signer, pause, expiry, per-transaction,
  daily, recipient, mint, and token-envelope checks.
- Separate SOL and SPL token spend counters.
- Policy dashboard for caps, expiry, allow-lists, token envelope, revoke, and
  rotate.
- Mock provider and API provider behind the same `PraxisProvider` seam.
- Simulation-first proposal cards and an activity log.
- Read-only token research with an explicit no-advice stance.
- Swap intents parsed as policy previews only. They are always blocked because
  `agent_swap` and Jupiter CPI are not implemented.

## Not Implemented

- Production authentication or per-user authorization.
- Durable database storage for threads, proposals, rejected activity, or users.
- Wallet-signed owner/admin transactions.
- SPL token account setup/funding flow for the live vault path.
- Durable rejected-action indexing. The on-chain action log stores allowed
  actions; rejected actions exist as failed transaction logs or session state.
- Real swaps, scheduled/DCA actions, bridges, billing, team accounts, or
  delegated authority over the user's main wallet.

## Next Priorities

### Phase 1: Demo Reliability

1. Run the full API path against localnet/devnet: initialize policy, fund SOL
   vault, configure token envelope, create/fund token vault account, and execute
   SOL plus SPL sends from the UI.
2. Add a setup script for vault associated token accounts and recipient token
   account checks.
3. Add API route tests for auth failure, oversized payloads, bad token config,
   sign proposal, rotate without next key, and policy updates.

Expected outcome: the demo is repeatable from a clean checkout and does not
depend on hand-created token accounts.

### Phase 2: MVP Foundations

1. Add wallet/session authentication.
2. Scope policies, threads, proposals, and activity by authenticated user.
3. Replace the in-memory server singleton with durable storage.
4. Move owner/admin authority to wallet-signed transactions or a clearly
   authorized backend custody model.

Expected outcome: multiple real users can use the app without sharing process
state or a public mutation token.

### Phase 3: Reliability And Auditability

1. Add timeouts around Anthropic, RPC, and indexer fetches.
2. Add rate limits for mutation routes and LLM-backed parsing.
3. Index failed transaction logs that emit `AgentActionRejected`.
4. Store token mint history for SPL activity so old records remain accurate
   after token reconfiguration.
5. Add Playwright coverage for the core UI flows.

Expected outcome: failures are bounded, observable, and reconstructable.

### Phase 4: Product Expansion

1. Consider `agent_swap` only if the program enforces mint/program allow-lists
   and value caps inside the swap instruction.
2. Consider scheduled actions only with mechanical triggers and the same Aegis
   envelope.
3. Avoid cross-chain agent execution unless the enforcement model can follow the
   value to the destination chain.

Expected outcome: new features strengthen the safety thesis instead of creating
escape hatches around it.

## Deliberate Non-Goals For Now

- No fake swap signing.
- No autonomous trading advice.
- No unbounded allow-lists.
- No production claims until auth, durable storage, key custody, rate limits,
  and live-path setup are complete.
