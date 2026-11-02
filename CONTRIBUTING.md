# Contributing to Praxis

[Home](README.md) · [Architecture](docs/ARCHITECTURE.md) · [Operations](docs/DEPLOY.md)

Start with the [mock walkthrough](README.md#run-it-locally), then read the
[trust boundaries](docs/ARCHITECTURE.md#trust-boundaries). The defining invariant
is simple: **the agent may interpret intent; Aegis enforces the envelope.**
A feature must not turn an off-chain check into the only thing protecting funds.

## Development loop

Install Bun and Node.js 20.9+, then from the repository root:

```bash
bun install --frozen-lockfile
(cd sdk && bun install --frozen-lockfile)
NEXT_PUBLIC_PRAXIS_PROVIDER=mock bun run dev
```

The SDK has a separate dependency install and lockfile; this is not a Bun
workspace. Mock mode is an in-memory product sandbox. For wallet auth, RPC,
real proposals, and stocks, use [API-mode setup](docs/DEPLOY.md#local-api-mode-on-devnet).

This checkout uses **Next.js 16.2.6**, not an older App Router contract. Follow
[AGENTS.md](AGENTS.md) and consult the installed guides in
`node_modules/next/dist/docs/` before changing Next.js code. In particular,
host routing lives in `proxy.ts`.

## Where changes belong

| Change | Relevant code |
| --- | --- |
| Conversation, policy, activity UI | `components/app/`; `components/app/mock/` for the matching demo behavior |
| Landing-page copy and visuals | `components/praxis/`, `data/`, `app/globals.css` |
| API contract and wire encoding | `app/api/`, `shared/src/types.ts`, `shared/src/provider.ts`, `shared/src/serde.ts` |
| Intent parsing and research | `server/agent/`; normalize every provider's output, including browser-supplied intent |
| Proposal execution and persistence | `server/provider/`, `server/aegis/` |
| Spending enforcement | `aegis/programs/aegis/src/` and its Rust tests |
| Stocks and scheduling | `server/stocks/`, `app/api/cron/stocks/route.ts` |
| SDK and agent-key isolation | `sdk/`, `signer/`, `server/agent/agentTxPolicy.ts` |

## Validate a change

Start with the nearest test, then run the same web/SDK gates as CI:

```bash
bun test --env-file=/dev/null server/agent/__tests__/intent.test.ts
bun run check
bun run praxis:stocksgate
```

`check` runs ESLint, app + SDK typechecks, the TypeScript tests, and a production
build. Tests explicitly ignore `.env`. The tests and offline demo gates need
no RPC, model key, Postgres, or Redis. Dependency installation and a fresh
`next/font/google` build can still need network access.

Other focused checks:

| Command | Purpose |
| --- | --- |
| `bun run test:watch` | TypeScript tests in watch mode |
| `bun run praxis:moneyshots` | Five mock product flows, including rejection and revoke |
| `bun run praxis:swapcheck` | Offline swap refusal checks |
| `bun run praxis:tokencheck` | Offline token-envelope checks |
| `(cd sdk && bun run build)` | Build the SDK's ESM, CJS, and type declarations |
| `docker compose up -d` then `bun run praxis:localcheck` | Exercise real local Postgres and Redis; mutates dedicated check records |

CI does **not** run Anchor tests or funded-cluster scripts. See the
[cluster-check table](docs/DEPLOY.md#verifying-a-cluster) before running anything
that creates accounts, mints tokens, changes policies, or sends funds.

### Aegis changes

The requested toolchain is pinned in `aegis/Anchor.toml`: Anchor **1.0.2** and
Solana **3.1.15**. Rust follows `aegis/rust-toolchain.toml` (`stable`). Do not
silently substitute another deployment toolchain.

```bash
bun run aegis:test
(cd aegis && NO_DNA=1 cargo test --test account_validation)
bun run aegis:idl
```

The enforcement suite includes T1–T10 plus stateful and account-substitution
tests. `aegis:idl` rebuilds and copies generated JSON and TypeScript into
`shared/src/idl/`; do not hand-edit generated artifacts. If the account layout
or instruction accounts change, address migrations and client/program rollout
together. Passing a TypeScript suite does not verify a deployed binary.

## Review checklist

- Keep monetary values as integer base units (`bigint` internally, decimal
  strings on the wire); test conversion and boundary behavior.
- Preserve owner/agent separation. Do not add an arbitrary-transaction signing
  path to the signer or treat the session as a read-only credential.
- Test allowed **and** refused behavior, stale proposals, and uncertain
  submission outcomes where relevant. Never retry an unknown transfer blindly.
- Preserve strict revision checks for all per-wallet state writes; contacts and
  conversation data share a document with execution claims.
- Keep mock and API behavior honest about capabilities. A mock transaction is
  not evidence that an instruction works on-chain.
- Update the closest user-facing guide, `.env.example`, or SDK reference when
  behavior changes. Prefer one canonical explanation with links over copies.

## Documentation and assets

The [README](README.md) is the product entrance; [GUIDE.md](docs/GUIDE.md) is
the user workflow; [DEPLOY.md](docs/DEPLOY.md) is the operator runbook;
[ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the implementation and its
limits. SDK and signer references stay beside their packages. The
[historical security report](audit_1/REPORT.md) is evidence of a dated review,
not the current operations manual or an audit badge.

Documentation assets live in `docs/assets/`. The hero is editable SVG using the
existing product mark and palette. Screenshots are actual local mock-mode
captures at 1280 × 1000 (the policy image is cropped to 720 pixels high): open
`/app`, request `send 0.5 SOL to maya`, capture the pending proposal, then
capture **Policy → Overview**. Use a deliberate mock-enabled production build
to omit development chrome, never those mock flags on a live deployment. Keep
the fixture caption, omit secrets and real wallet data, and replace screenshots when their
UI stops matching the product. Don't use a fabricated mockup as product proof.

## Scope and disclosure

Do not commit `.env`, private keys, session cookies, signer tokens, or database
exports. Use disposable devnet identities for reproduction. Report a suspected
vulnerability privately to the maintainers rather than posting exploit details
or credentials in a public issue; no dedicated security contact is configured
in this repository. The [SDK's MIT license](sdk/LICENSE) does not establish a
license for the rest of the project.
