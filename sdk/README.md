# @usepraxis/sdk

Typed client for a hosted **Praxis** agent — turn natural language into Solana
actions that are enforced on-chain by the **Aegis** policy program.

The agent's LLM, its scoped agent key, and Aegis enforcement all live
server-side. This SDK is an authenticated *client* of that backend: it signs a
wallet-ownership challenge, holds the session, and drives the agent. **It never
holds your model keys or agent private key.**

```bash
npm install @usepraxis/sdk
# or: bun add @usepraxis/sdk / pnpm add @usepraxis/sdk
```

## Quickstart

```ts
import { PraxisClient, keypairSigner } from "@usepraxis/sdk";

const praxis = new PraxisClient({
  baseUrl: "https://your-praxis.app",
  signer: keypairSigner(process.env.PRAXIS_SECRET_KEY!), // base58 secret key
});

await praxis.connect(); // wallet sign-in handshake

const { message, proposals } = await praxis.ask("send 0.5 SOL to maya");

for (const p of proposals) {
  console.log(p.check.allowed ? "ALLOWED" : `BLOCKED — ${p.check.reason}`);
  if (p.check.allowed) await praxis.signProposal(p.id); // Aegis enforces caps on-chain
}
```

A proposal is a set of readings taken when it was produced — fee, simulated
outcome, remaining daily envelope. It stays signable for 24 hours; after that
the backend refuses it and you ask again. Aegis enforces the envelope either
way, but it cannot tell whether the card you read is the one you signed.

`ask()` returns once the agent has finished — the API resolves `send` only after
the reply is ready, so there is no polling.

## How auth works

`connect()` runs the wallet-ownership handshake for you:

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

> **Owner wallet-signed path.** `buildOwnerTransaction()` returns an *unsigned*
> transaction; you sign it with a transaction-capable wallet (a browser wallet
> adapter or `@solana/web3.js`) and submit the result with
> `submitOwnerTransaction()`. The SDK's `keypairSigner` signs the sign-in
> *message* only, not transactions — so a pure-Node owner-action flow must bring
> its own transaction signer.
>
> Pass the whole draft back. Since **0.5.0** it carries a `draft` token: the
> backend refuses to relay a transaction it did not build, which is what keeps
> the server-side checks on an action (a token balance still in the vault, a
> mint Aegis cannot drive) from being skippable by assembling your own bytes.
> Mutate `transaction` only; leave the other fields alone.

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
