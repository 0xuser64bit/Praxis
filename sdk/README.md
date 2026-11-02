# @usepraxis/sdk

[Praxis](https://github.com/0xuser64bit/Praxis) ·
[User guide](https://github.com/0xuser64bit/Praxis/blob/main/docs/GUIDE.md) ·
[Architecture](https://github.com/0xuser64bit/Praxis/blob/main/docs/ARCHITECTURE.md)

Typed client for a hosted **Praxis** agent — turn natural language into Solana
actions that are enforced on-chain by the **Aegis** policy program.

The backend runs intent parsing and scoped agent signing; Aegis enforces the
policy **on Solana**, not in the SDK or backend. This SDK signs a
wallet-ownership challenge, holds the session, and drives the agent. **It never
holds your model keys or agent private key.**

```bash
npm install @usepraxis/sdk
# or: bun add @usepraxis/sdk / pnpm add @usepraxis/sdk
```

## Quickstart

Use Node.js 18+ (or Bun) and a reachable API-mode backend. Mock UI mode does
not provide a mock HTTP API. Initialize and fund this wallet's Aegis policy,
ensure the agent has fee SOL, and save the recipient contact through the app
first. Use a dedicated devnet identity, not a primary wallet secret.

Set `PRAXIS_URL` to your backend origin and `PRAXIS_SECRET_KEY` to a dedicated
wallet's base58 secret. Inject secrets through your environment; do not put
them in source, command history, or logs.

```ts
import { PraxisClient, keypairSigner } from "@usepraxis/sdk";

const praxis = new PraxisClient({
  baseUrl: process.env.PRAXIS_URL!,
  signer: keypairSigner(process.env.PRAXIS_SECRET_KEY!),
});

await praxis.connect();

const { proposals } = await praxis.ask("send 0.01 SOL to maya");

for (const proposal of proposals) {
  console.log(proposal.id, proposal.detail, proposal.check);
}
```

This prepares proposals only. After inspecting the exact recipient, amount,
and result, submit the selected one with
`await praxis.signProposal(proposal.id)`. **That call can move funds** using
the backend's agent key without another owner-wallet signature. An allowed
preview is not a substitute for your own approval rules.

`ask()` can return no proposals when the agent asks a question, provides
research, or declines. Inspect `message.blocks` in that case. Pass the returned
`threadId` to the next `ask(text, threadId)` to keep the conversation together.

A proposal stays signable for a week. Its amount is fixed when it is built and
Aegis enforces the envelope live at submit, so an older card still moves
exactly what it says — what drifts are the readings on it (fee, simulated
outcome, remaining daily envelope). Past a week the backend refuses it and you
ask again.

`ask()` returns once the agent has finished — the API resolves `send` only after
the reply is ready, so there is no polling.

## Client options

| Option | Default / purpose |
| --- | --- |
| `baseUrl` | Required backend **origin**, without `/api/praxis` |
| `signer` | Needed for `connect()` and automatic reauthentication |
| `fetch` | Global `fetch`; inject a compatible implementation for custom transports |
| `timeoutMs` | 20,000 ms for ordinary reads and mutations |
| `agentTimeoutMs` | 60,000 ms for `send`/`ask`, never below `timeoutMs` |

Timeouts do not prove that a submitted transaction failed. Read the proposal
and reconcile its signature before requesting a replacement transfer.

## How auth works

`connect()` runs the wallet-ownership handshake. All auth paths below are
relative to `/api/praxis`:

1. `POST /auth/challenge` → returns a `message` to sign.
2. The signer produces an Ed25519 signature over that message.
3. `POST /auth/verify` → sets a session cookie, which the SDK stores in its own
   cookie jar (Node's `fetch` does not persist cookies between calls).

The signed-in wallet is the **owner** whose Aegis policy PDA scopes everything.

Sessions are short on purpose — holding one is enough to move value *within*
the Aegis envelope, with no further wallet signature — so a long-running
process will outlive its cookie. When a signer is configured, the SDK runs the
handshake again on a `401` and retries the call once; you do not need your own
reconnect loop. Without a signer, the `401` is returned as-is.

## Signers

Provide any `PraxisSigner` — `{ address, signMessage(bytes) }`.

- **Node / backend:** `keypairSigner(secret)` accepts a 64-byte keypair or
  32-byte seed as raw bytes, a number array, or a base58 string.
- **Browser:** wrap a wallet adapter:
  ```ts
  const signer = {
    address: wallet.publicKey.toBase58(),
    signMessage: (m: Uint8Array) => wallet.signMessage(m),
  };
  ```
  > Note: browser usage is **same-origin only** — the API enforces same-origin
  > on mutations and sets no CORS headers. From a third-party site, run the SDK
  > server-side. (This is why the SDK is Node-first.)

## Money

All monetary values cross the wire as **decimal strings of integer base units**
(lamports / token base units) — never floats. Helpers convert safely:

```ts
import { humanToBaseUnits, baseUnitsToHuman, toBaseUnits } from "@usepraxis/sdk";

humanToBaseUnits("0.5", 9);          // "500000000"
baseUnitsToHuman("500000000", 9);    // "0.5"
toBaseUnits("500000000");            // 500000000n
```

## API surface

| Area | Methods |
|------|---------|
| Auth | `connect()`, `session()`, `logout()` |
| Conversation | `ask()`, `send()`, `newThread()`, `signProposal()`, `cancelProposal()` |
| Reads | `getPolicy()`, `getThreads()`, `getThread()`, `getProposal()`, `getProposals()`, `getActivity()`, `getAddressBook()`, `getSchedules()`, `getVersion()` |
| Contacts | `addContact()`, `removeContact()` — labels only, no signing power |
| Recurring | `cancelSchedule()` — stop a recurring buy (fires only ever emit proposals) |
| Policy (server-key) | `bootstrapPolicy()`, `fundVault()`, `withdrawVault()`, `updatePolicy()`, `configureToken()`, `prepareTokenAccounts()`, `revokeAgent()`, `rotateAgent()`, `addToAllowList()`, `removeFromAllowList()`, `deleteAgent()` |
| Owner (wallet-signed) | `buildOwnerTransaction()`, `submitOwnerTransaction()` |
| Stocks (PreStocks) | `getTokenUniverse()`, `getStockResearch()` — see `examples/stocks-dca.ts` |

`session()` returns the current `SessionInfo` or `null` when signed out.

The **Policy (server-key)** methods require the backend to hold an owner
keypair matching the policy. They are not a replacement for browser-wallet
owner signatures on a normal hosted deployment. Prefer the wallet-signed
build/sign/submit path; do not upload user owner keys to enable these methods.

> **Owner wallet-signed path.** `buildOwnerTransaction()` returns an *unsigned*
> transaction; you sign it with a transaction-capable wallet (a browser wallet
> adapter or `@solana/web3.js`) and submit the result with
> `submitOwnerTransaction()`. The SDK's `keypairSigner` signs the sign-in
> *message* only, not transactions — so a pure-Node owner-action flow must bring
> its own transaction signer.
>
> Pass the whole draft back. Since **0.5.0** it carries a `draft` token: the
> backend refuses to relay a transaction it did not build, which is what keeps
> the server-side checks on an action (the configured mint's vault balance, a
> mint Aegis cannot drive) from being skippable by assembling your own bytes.
> Mutate `transaction` only; leave the other fields alone.

### Wallet-signed owner transaction

For a Node devnet owner flow, install `@solana/web3.js` separately. The
transaction signer must be the **same owner** used for `connect()`. This
example assumes `praxis` is connected and `owner` is that wallet's `Keypair`:

```ts
import { Transaction } from "@solana/web3.js";

const draft = await praxis.buildOwnerTransaction({
  kind: "fundVault",
  amount: "10000000",
});
const transaction = Transaction.from(Buffer.from(draft.transaction, "base64"));
transaction.sign(owner);
const { sig } = await praxis.submitOwnerTransaction({
  ...draft,
  transaction: transaction.serialize().toString("base64"),
});
console.log(sig);
```

This deposits **0.01 SOL** and incurs transaction fees. Sign and submit before
the draft's blockhash expires. If it expires, request a new draft; do not
replace its blockhash or other signed fields yourself.

### Stock and schedule semantics

Stocks require a backend with `PRAXIS_STOCKS_ENABLED=1`; the universe is empty
otherwise. A `buy` transfers stock tokens already in a vault; it is not an
exchange. Dollar inputs convert once at proposal/schedule creation. Due
schedules create proposals only, with no automatic signing. One policy has
one active SPL mint. See the
[stock workflow](https://github.com/0xuser64bit/Praxis/blob/main/docs/GUIDE.md#stock-token-workflows).

The source checkout includes `examples/quickstart.ts` and
`examples/stocks-dca.ts`. Run them from `sdk/` with Bun after setting
`PRAXIS_URL` and `PRAXIS_SECRET_KEY`. **Both examples automatically submit
allowed proposals**; inspect their code and use devnet. They are not included
in the published package's file list.

## Errors

Non-2xx responses throw `PraxisApiError` with `.status`, `.type`, a stable
`.code` to branch on, and helpers `.isAuth` / `.isRateLimited` / `.isInput` /
`.isNotFound` / `.isConfig` / `.isConflict` / `.isPolicyNotFound` / `.isServer`. A client-side timeout or connection failure throws
`PraxisApiError` with `.isTimeout` / `.isNetwork` (and `.status === 0`, with the
original error on `.cause`). SDK-side misconfiguration throws `PraxisConfigError`.

```ts
import { PraxisApiError } from "@usepraxis/sdk";
try {
  await praxis.ask("…");
} catch (e) {
  if (e instanceof PraxisApiError && e.isRateLimited) { /* back off */ }
}
```

## License

MIT
