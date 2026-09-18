# PreStocks spike report (C01)

Date: 2026-09-18 · Script: `bun run praxis:stockscheck` · API: `https://prestocks.com/api/prestocks`

## Verified (live fetch 2026-09-18)

- Response is a JSON array, 8 entries. Core fields present: `symbol`, `contract_address`,
  `tokenPrice`, `markPrice`, `supply`, `external_url`, `description`, `image`.
- All 8 expected symbols present with spec-matching mints and `tokenPrice > 0`, `markPrice > 0`:

| Symbol | Mint | tokenPrice | markPrice |
|---|---|---:|---:|
| ANDURIL | `PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB` | 155.89 | 153.49 |
| ANTHROPIC | `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw` | 1024.03 | 1020.25 |
| FIGUREAI | `PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd` | 180.53 | 180.62 |
| KALSHI | `PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua` | 882.54 | 883.68 |
| NEURALINK | `PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S` | 374.59 | 322.50 |
| OPENAI | `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF` | 1088.50 | 976.27 |
| POLYMARKET | `Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP` | 145.16 | 144.44 |
| SPACEX | `PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh` | 121.59 | 152.13 |

Note the `tokenPrice` vs `markPrice` spread (e.g. SPACEX, NEURALINK, OPENAI diverge) —
display both, labeled, until semantics are confirmed with PreStocks. Never present one as "the price".

## Open (not asserted — needs funded-RPC spike before C04)

- [ ] `decimals` per mint (absent from API; resolve via `getTokenSupply` on mainnet).
- [ ] DexScreener pairs / liquidity per mint.
- [ ] Jupiter `USDC -> mint` routability at $10 (determines swap vs transfer-only).
- [ ] Mint vs secondary-transfer mechanics (can the vault hold these SPLs directly? ATA creation OK?).

Probe commands for the owner (run before C04):

```bash
bun run praxis:stockscheck
# then, with a mainnet RPC:
# bun -e '...' # getTokenSupply for each mint above
```

## Decision gate (binding for C02–C06)

**Default: transfer-only.** Buys are `transfer` of pre-funded stock SPLs through the existing
`agent_transfer_spl` + `checkTokenTransferPolicy` path. `swap X for <stock>` stays `swap_stub`
blocked with honest copy. This decision flips to swap-route only if a C01-follow-up probe shows
a Jupiter route behind the existing mint/program allow-lists — as its own commit with evidence here.
