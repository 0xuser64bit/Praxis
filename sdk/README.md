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

`ask()` returns once the agent has finished — the API resolves `send` only after
the reply is ready, so there is no polling.

## How auth works

`connect()` runs the wallet-ownership handshake for you:

1. `POST /auth/challenge` → returns a `message` to sign.
2. The signer produces an Ed25519 signature over that message.
3. `POST /auth/verify` → sets a session cookie, which the SDK stores in its own
   cookie jar (Node's `fetch` does not persist cookies between calls).

The signed-in wallet is the **owner** whose Aegis policy PDA scopes everything.

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
| Reads | `getPolicy()`, `getThreads()`, `getThread()`, `getProposal()`, `getActivity()`, `getAddressBook()`, `isThinking()`, `getVersion()` |
| Policy (server-key) | `bootstrapPolicy()`, `fundVault()`, `withdrawVault()`, `updatePolicy()`, `configureToken()`, `prepareTokenAccounts()`, `revokeAgent()`, `rotateAgent()`, `addToAllowList()`, `removeFromAllowList()`, `deleteAgent()` |
| Owner (wallet-signed) | `buildOwnerTransaction()`, `submitOwnerTransaction()` |

`session()` returns the current `SessionInfo` or `null` when signed out.

> **Owner wallet-signed path.** `buildOwnerTransaction()` returns an *unsigned*
> transaction; you sign it with a transaction-capable wallet (a browser wallet
> adapter or `@solana/web3.js`) and submit the result with
> `submitOwnerTransaction()`. The SDK's `keypairSigner` signs the sign-in
> *message* only, not transactions — so a pure-Node owner-action flow must bring
> its own transaction signer.

## Errors

Non-2xx responses throw `PraxisApiError` with `.status`, `.type`, and helpers
`.isAuth` / `.isRateLimited` / `.isInput` / `.isNotFound` / `.isConfig` /
`.isServer`. A client-side timeout or connection failure throws
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
