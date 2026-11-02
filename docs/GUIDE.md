# Using Praxis

[Home](../README.md) / User guide · [Setup and operations](DEPLOY.md) · [Architecture](ARCHITECTURE.md)

Praxis lets you give a Solana agent a **bounded spending envelope**. You decide
which funds to place in its vault, what it may spend, who it may pay, and when
its authority expires. The conversation turns intent into proposals; Aegis
enforces the on-chain policy when a transfer executes.

## Choose an experience

| Mode | What you need | What happens |
| --- | --- | --- |
| Local mock | [The README quick-start](../README.md#run-it-locally) | Fixture balances and in-memory state. No wallet or chain connection. Reload resets it. |
| Hosted devnet | [The app](https://app.usepraxis.fun), a compatible Solana wallet, devnet SOL | Real devnet transactions with test assets, subject to the operator's configuration. |
| Your API deployment | [API-mode setup](DEPLOY.md#local-api-mode-on-devnet) | Your RPC, agent signer, state storage, and optional model providers. |

Use devnet for experimentation. A devnet mirror token is not a real stock
token, and a mock success is not a successful on-chain transfer.

## Your first devnet transfer

1. **Connect and sign in.** Open the app with a wallet that supports message
   and transaction signing, such as Phantom. Switch to devnet. The message
   signature proves wallet ownership and creates a session; it is not a
   transaction or an unlimited wallet approval.
2. **Create the vault.** Follow the initialization prompt. Review the policy
   and funding transaction in your wallet. Fund the owner wallet with devnet
   SOL first; the operator must separately fund the agent key for transfer fees.
3. **Review Policy.** Set a small per-transfer cap, daily budget, expiry, and
   recipient restrictions appropriate for the demo. Keep enough SOL outside
   the vault for owner transactions.
4. **Save a recipient.** Send `save <recipient-address> as maya`, replacing the
   placeholder with a real devnet recipient. API-mode contacts start empty by
   default; operator-seeded contacts may exist, but mock contacts do not carry over.
5. **Ask for a small send.** Try `send 0.01 SOL to maya`. Check the resolved
   address, amount, fee, simulation, and policy result.
6. **Confirm the proposal.** **Confirm & submit** asks the backend's scoped
   agent key to sign and send. It does not open a second owner-wallet signature
   prompt. Inspect the resulting status and transaction link in Activity.

**A valid session can spend within your envelope.** Do not share cookies, leave
an unattended signed-in browser, or treat an SDK session as read-only.
The default session lifetime is 24 hours; the operator can change it.

## Read a proposal before you confirm

| Field | What it means |
| --- | --- |
| Recipient | The resolved wallet. A saved name is a convenience, not an authorization boundary. Verify the address. |
| Amount and asset | The exact quantity the transaction will attempt to move. Money is represented as integer base units internally. |
| Network fee | An estimate from proposal creation, not a guaranteed final cost. |
| Simulation | A preview against the state available at that moment. It can go stale. |
| Aegis verdict | The off-chain explanation of the envelope. The program checks the actual policy again at execution. |
| Remaining budget | An estimate that other transfers or policy changes can alter before submission. |

Proposals remain signable for **seven days**. Their quantities are fixed, but
prices, fee estimates, vault balances, and remaining budgets can change. Cancel
an obsolete proposal and ask again rather than relying on an old preview.

A blocked proposal cannot execute through the app. A policy rejection is an
expected outcome, not permission to widen the budget automatically. If you do
change the policy, review and sign that separate owner transaction yourself.

### When a transaction is still submitted

A lost RPC confirmation does not mean a transfer failed. Praxis keeps an
uncertain transaction in `submitted` state and reconciles its signature on
later reads. **Do not create a replacement transfer until you have checked the
original outcome.** This avoids paying twice for the same intent.

## Useful things to say

| Example | Result or requirement |
| --- | --- |
| `send 0.01 SOL to maya` | Native SOL transfer proposal; Maya must resolve. |
| `send 2 USDC to maya` | Token proposal; the configured envelope must use that mint and the vault must hold it. |
| `save <address> as ops` | Save an off-chain contact label. It does not put the wallet on the recipient allow-list. |
| `send 0.1 SOL to alex` | Asks for clarification if multiple contacts match. |
| `what's bonk doing this week` | Read-only research, with available sources and missing-data disclosures. |
| `how does my policy keep me safe` | An explanation of the current envelope. |
| `set my daily limit to 1 SOL` | An owner policy-change request, not an agent transfer. Your wallet must sign it. |
| `pause the agent` / `resume the agent` | Owner-signed pause change. Resume alone cannot restore a revoked authority. |
| `swap 100 usdc for jup` | Preview only; swaps are always blocked. |

The local deterministic parser supports a smaller vocabulary than the model
providers. When a provider is unavailable, use direct phrasing and explicit
amounts. A clarification is preferable to a guessed recipient or quantity.

## Manage the envelope

![Praxis Policy dashboard showing the vault, remaining daily budget, session-key expiry, and Revoke agent control.](assets/policy.png)

*Actual local mock-mode dashboard, with fixture balances and addresses.*

- **Funding** places SOL in a separate vault. It does not authorize the agent
  to spend other funds in your wallet.
- **SOL and tokens have independent caps.** Token caps are quantities of the
  currently configured mint, not universal dollar limits.
- **The daily window is a rolling 24-hour bucket.** It resets on the first
  eligible transfer after the previous window has elapsed, not at local
  midnight and not as a sliding sum of individual transactions.
- **An empty recipient allow-list means any recipient is allowed.** Add
  restrictions explicitly if you want a closed set of destinations.
- **Pause** stops agent transfers while retaining the registered key.
  **Revoke** pauses and clears the key. Re-enabling a revoked agent requires
  owner-approved rotation to a configured key, not just unpausing.
- **Owner actions bypass agent caps.** That is why policy changes, SOL
  withdrawal, rotation, revocation, and teardown require your wallet signature.

The dashboard can configure a token envelope and prepare its accounts, but
there is no general token-vault deposit UI. The operator can use the
[token-account helper](DEPLOY.md#verifying-a-cluster); stock mirrors can use
the configured demo faucet. Teardown checks the **currently configured mint's**
vault balance, not every mint ever deposited. Changing the envelope does not
move older token balances. Track those balances before switching mints or
deleting a policy; there is no general token-recovery UI.

## Stock-token workflows

These features require an API deployment with stocks enabled. The supported
symbols are ANDURIL, ANTHROPIC, FIGUREAI, KALSHI, NEURALINK, OPENAI,
POLYMARKET, and SPACEX. The operator can filter the displayed universe.

### Try an OPENAI mirror transfer

1. In **Policy → Token transfers**, select **OPENAI** and sign the owner
   transaction that configures its mint and caps. One policy holds only one
   token envelope at a time.
2. If the operator enabled the devnet faucet, request **$1,000 demo OPENAI**.
   This mints a test quantity into your vault; it does not purchase anything.
   The faucet allows three grants per wallet per day.
3. Ask `research openai`, then `buy $40 openai`.
4. Review the fetched price, derived quantity, recipient, and policy result.
   With no named recipient, a stock transfer settles to your own wallet.
5. Confirm the proposal and inspect the transaction.

**“Buy” means a transfer out of a prefunded vault.** Praxis does not route an
exchange, acquire an equity interest, or spend USDC to purchase stock. Mirror
mints reproduce the symbol, nine-decimal scale, and Token-2022 transfer path;
they do not reproduce real issuer privileges or economic value.

### Dollars, schedules, and baskets

- `buy $40 openai` converts dollars using the fetched PreStocks token price.
  `buy 0.05 openai` means a token quantity. If the required price or decimals
  cannot be resolved, Praxis asks instead of guessing.
- `buy $50 spacex every monday` fixes a token quantity **when the schedule is
  created**. It is not a fresh $50 conversion every Monday. The server's daily
  cron creates due proposals; you must still confirm each one. Check schedules
  in the app, or use `getSchedules()` / `cancelSchedule()` in the SDK.
- `buy ai basket $60` splits the dollar total across the configured basket.
  It is all-or-clarify at proposal creation: a blocked or unpriceable leg
  prevents the basket from being stored. It is **not an atomic multi-token
  transaction**. With the current single-mint envelope, other-mint legs cannot
  pass real execution checks, so a multi-stock basket can clarify rather than
  produce executable proposals.

Research is informational, not buy/sell/hold advice. For real PreStocks mints,
issuer delegate, freeze, and pause powers are outside the agent policy. Token
extensions and market data may change; read the live research disclosures.

## Model keys and privacy

The operator can configure Gemini and Groq server-side. You can instead use
the app's own-key option to call a supported model from your browser. That key
is stored in browser local storage and is not sent to Praxis; the parsed intent
is sent to the backend and checked again. If the browser call fails, the app
can fall back to shared parsing and labels that fallback.

Browser local storage is not a hardware vault. Use restricted keys where your
provider supports them, do not use this on a shared browser, and clear saved
keys when finished. Your current prompt is sent to the selected model provider;
threads, contacts, proposals, and activity are stored by the Praxis deployment
in API mode. Conversation history is not replayed to the intent model.

## If something goes wrong

| Symptom | Next step |
| --- | --- |
| Unknown or ambiguous name | Save a full address under a unique label; do not guess. |
| Policy blocks the amount | Review remaining budget, expiry, pause state, recipient list, and active mint. |
| Token transfer cannot simulate | Check mint existence on the target cluster, token program, token accounts, and vault balance. Mainnet mints are not devnet mints. |
| No faucet button | The operator may not have enabled mirror minting. Ask for the correct funding procedure. |
| Re-enable is unavailable | The operator must configure a next agent public key or local next keypair. |
| Schedule does not fire | Ask the operator to check cron auth, cron hour, storage, and runner logs. |
| Transaction remains submitted | Check its signature and let reconciliation run; do not blindly send again. |
| Server configuration error | The operator needs the server log; clients intentionally receive a generic message. |

Operators: continue with [troubleshooting](DEPLOY.md#troubleshooting).
Developers: see [proposal lifecycle and concurrency](ARCHITECTURE.md#concurrency-and-state).
