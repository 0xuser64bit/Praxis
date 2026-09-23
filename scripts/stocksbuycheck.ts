/**
 * The money shot, end to end, against a live cluster: a Token-2022 tokenized
 * stock is bought through Aegis, and an over-cap buy is refused ON-CHAIN.
 *
 * This is the product's core claim — "text to invest in stocks
 * on Solana, with limits even a hacked AI can't break" — so it is asserted by
 * a script rather than a screenshot. Everything runs through the same
 * AegisClient the product uses; nothing is special-cased for the demo.
 *
 *   SOLANA_RPC_URL=http://127.0.0.1:8899 \
 *   PRAXIS_STOCKS_ENABLED=1 PRAXIS_STOCK_MINTS='{"OPENAI":"..."}' \
 *   PRAXIS_OWNER_KEYPAIR_PATH=./keys/owner.json \
 *   PRAXIS_AGENT_KEYPAIR_PATH=./keys/agent.json \
 *     bun run praxis:stocksbuycheck
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { RejectReason } from "@praxis/shared";

import { AegisClient } from "../server/aegis/client";
import { TOKEN_2022_PROGRAM_ID } from "../server/aegis/constants";
import { findAssociatedTokenAddress, findVaultPda } from "../server/aegis/pdas";
import {
  getServerConfig,
  requireAgentKeypair,
  requireOwnerKeypair,
  resetConfigForTests,
} from "../server/env";
import { PraxisNotFoundError } from "../server/errors";
import { formatUnits } from "../server/units";

const SYMBOL = (process.env.PRAXIS_BUYCHECK_SYMBOL ?? "OPENAI").toUpperCase();

let failures = 0;
function assert(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`│   ✓ ${label}${detail ? `  ↳ ${detail}` : ""}`);
  else {
    failures++;
    console.log(`│   ✗ ${label}  ↳ FAILED ${detail}`);
  }
}

/** Token-2022 TransferChecked, owner-signed: seeds the vault's token account. */
function transferCheckedIx(args: {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  amount: bigint;
  decimals: number;
}) {
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(args.amount, 1);
  data.writeUInt8(args.decimals, 9);
  return {
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: args.source, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.destination, isSigner: false, isWritable: true },
      { pubkey: args.authority, isSigner: true, isWritable: false },
    ],
    data,
  };
}

async function tokenBalance(conn: Connection, ata: PublicKey): Promise<bigint> {
  const info = await conn.getAccountInfo(ata, "confirmed");
  if (!info || info.data.length < 72) return 0n;
  return info.data.readBigUInt64LE(64);
}

async function main() {
  resetConfigForTests();
  const config = getServerConfig();
  const owner = requireOwnerKeypair(config);
  const agent = requireAgentKeypair(config);
  const client = new AegisClient(config);
  const conn = new Connection(config.rpcUrl, config.commitment);

  const token = config.tokens.find((t) => t.symbol === SYMBOL);
  if (!token) {
    console.log(`No ${SYMBOL} in the configured universe. Set PRAXIS_STOCKS_ENABLED=1.`);
    process.exit(1);
  }
  const mint = new PublicKey(token.mint);
  const unit = 10n ** BigInt(token.decimals);

  console.log("┌──── STOCK BUY (Token-2022, live cluster) ─────────────────────────────");
  console.log(`│ cluster : ${config.rpcUrl}`);
  console.log(`│ symbol  : ${SYMBOL}  mint ${token.mint}  decimals ${token.decimals}`);

  // The mint must really be Token-2022, or this proves nothing.
  const mintInfo = await conn.getAccountInfo(mint, "confirmed");
  assert(
    "mint is Token-2022",
    Boolean(mintInfo && mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)),
    mintInfo?.owner.toBase58(),
  );

  // 1. Policy exists (bootstrap once).
  try {
    await client.getPolicy();
    console.log("│   · policy already initialized");
  } catch (error) {
    if (!(error instanceof PraxisNotFoundError)) throw error;
    await client.bootstrapPolicy(1_000_000_000n);
    console.log("│   · policy bootstrapped");
  }

  // 2. Token envelope: 100 per tx, 250 daily (token units).
  await client.configureToken({
    tokenMint: token.mint,
    tokenMaxPerTx: 100n * unit,
    tokenDailyLimit: 250n * unit,
  });
  const policy = await client.getPolicy();
  assert("token envelope configured", policy.tokenMint === token.mint);

  // 3. Seed the vault's token account from the owner's supply.
  const vault = findVaultPda(new PublicKey(policy.address), config.programId);
  const vaultAta = findAssociatedTokenAddress(vault, mint, TOKEN_2022_PROGRAM_ID);
  const ownerAta = findAssociatedTokenAddress(owner.publicKey, mint, TOKEN_2022_PROGRAM_ID);
  await client.ensureSplTokenAccounts(token.mint, [owner.publicKey]);
  if ((await tokenBalance(conn, vaultAta)) < 500n * unit) {
    const tx = new Transaction().add(
      transferCheckedIx({
        source: ownerAta,
        mint,
        destination: vaultAta,
        authority: owner.publicKey,
        amount: 1000n * unit,
        decimals: token.decimals,
      }),
    );
    await sendAndConfirmTransaction(conn, tx, [owner], { commitment: config.commitment });
  }
  const vaultBefore = await tokenBalance(conn, vaultAta);
  assert("vault token account funded", vaultBefore > 0n, `${formatUnits(vaultBefore, token.decimals)} ${SYMBOL}`);

  // 4. THE BUY: recipient gets 40 through agent_transfer_spl.
  const recipient = Keypair.generate().publicKey;
  await client.ensureSplTokenAccounts(token.mint, [recipient]);
  const recipientAta = findAssociatedTokenAddress(recipient, mint, TOKEN_2022_PROGRAM_ID);

  const preview = await client.simulateAgentTransferSpl(recipient, token, 40n * unit);
  assert("simulation allows a 40-unit buy", preview.check.allowed, preview.check.reason ?? "");

  const exec = await client.executeAgentTransferSpl(recipient, token, 40n * unit);
  assert("buy CONFIRMED on-chain", exec.status === "confirmed", exec.sig ?? exec.check.reason ?? "");
  if (exec.sig) console.log(`│   · signature ${exec.sig}`);

  const recipientAfter = await tokenBalance(conn, recipientAta);
  const vaultAfter = await tokenBalance(conn, vaultAta);
  assert(
    "recipient credited exactly 40",
    recipientAfter === 40n * unit,
    `${formatUnits(recipientAfter, token.decimals)} ${SYMBOL}`,
  );
  assert("vault debited exactly 40", vaultBefore - vaultAfter === 40n * unit);

  // 5. THE BLOCK: over the per-tx cap, refused by the program itself.
  const over = await client.executeAgentTransferSpl(recipient, token, 500n * unit, {
    skipPreflight: true,
  });
  assert("over-cap buy REJECTED on-chain", over.status === "rejected", over.check.reason ?? "");
  assert(
    "rejection reason is the per-tx cap",
    over.check.reasonCode === RejectReason.OverPerTx,
    String(over.check.reasonCode),
  );
  const vaultFinal = await tokenBalance(conn, vaultAta);
  assert("vault untouched by the blocked buy", vaultFinal === vaultAfter);

  // 6. The agent key alone cannot exceed the envelope — that is the thesis.
  assert("agent is the on-chain authority", policy.agentAuthority === agent.publicKey.toBase58());

  console.log("└───────────────────────────────────────────────────────────────────────");
  if (failures === 0) {
    console.log("\nSTOCK BUY: PASS ✅  (Token-2022 buy landed; over-cap refused by Aegis)");
    process.exit(0);
  }
  console.log(`\nSTOCK BUY: FAIL ❌ — ${failures} assertion(s) failed.`);
  process.exit(1);
}

void main();
