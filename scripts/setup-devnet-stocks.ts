/**
 * Create devnet mirror mints for the PreStocks universe.
 *
 * The real PreStocks mints live on mainnet only, so a devnet deployment
 * cannot move them no matter what the program supports. This mints a
 * Token-2022 stand-in per symbol on the demo cluster, funds the owner
 * wallet with supply, and prints the `PRAXIS_STOCK_MINTS` block to paste
 * into `.env`.
 *
 * What a mirror reproduces: the symbol, the decimals (9), and the token
 * program (Token-2022) — i.e. everything the buy path actually exercises.
 * What it does NOT reproduce: the issuer's permanent-delegate, freeze and
 * pause authorities. Prices and research still come from the live PreStocks
 * API, keyed by symbol. The product labels a mirrored universe as such.
 *
 *   SOLANA_RPC_URL=https://api.devnet.solana.com \
 *   PRAXIS_OWNER_KEYPAIR_PATH=./keys/owner.json \
 *     bun run praxis:setup-devnet-stocks
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "../server/aegis/constants";
import { findAssociatedTokenAddress } from "../server/aegis/pdas";
import { getServerConfig, requireOwnerKeypair } from "../server/env";
import { DEFAULT_STOCK_DECIMALS, STOCK_LIST } from "../server/stocks/universe";

/** Bare Token-2022 mint with no extensions. */
const MINT_LEN = 82;
/** Initial supply minted to the owner, in whole tokens. */
const SUPPLY = BigInt(process.env.PRAXIS_MIRROR_SUPPLY ?? "100000");

function initializeMint2Ix(mint: PublicKey, decimals: number, authority: PublicKey) {
  // InitializeMint2: tag 20, decimals u8, mintAuthority 32, freezeOption u8 (+32).
  const data = Buffer.alloc(1 + 1 + 32 + 1);
  data.writeUInt8(20, 0);
  data.writeUInt8(decimals, 1);
  authority.toBuffer().copy(data, 2);
  data.writeUInt8(0, 34); // no freeze authority — a mirror should not be freezable
  return {
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    data,
  };
}

function mintToIx(mint: PublicKey, destination: PublicKey, authority: PublicKey, amount: bigint) {
  // MintTo: tag 7, amount u64 LE.
  const data = Buffer.alloc(9);
  data.writeUInt8(7, 0);
  data.writeBigUInt64LE(amount, 1);
  return {
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  };
}

function createAtaIdempotentIx(payer: PublicKey, owner: PublicKey, mint: PublicKey, ata: PublicKey) {
  return {
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  };
}

async function main() {
  const config = getServerConfig();
  const owner = requireOwnerKeypair(config);
  const conn = new Connection(config.rpcUrl, config.commitment);

  console.log("┌──── DEVNET MIRROR MINTS (PreStocks universe) ─────────────────────────");
  console.log(`│ cluster : ${config.rpcUrl}`);
  console.log(`│ owner   : ${owner.publicKey.toBase58()}`);
  const balance = await conn.getBalance(owner.publicKey);
  console.log(`│ balance : ${(balance / 1e9).toFixed(3)} SOL`);
  if (balance < 0.2e9) {
    console.log("│ ✗ owner needs SOL for rent. `solana airdrop 2 --url devnet`");
    process.exit(1);
  }

  const rent = await conn.getMinimumBalanceForRentExemption(MINT_LEN);
  const created: Record<string, string> = {};

  for (const stock of STOCK_LIST) {
    const mint = Keypair.generate();
    const ata = findAssociatedTokenAddress(owner.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID);
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: owner.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: rent,
        space: MINT_LEN,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      initializeMint2Ix(mint.publicKey, DEFAULT_STOCK_DECIMALS, owner.publicKey),
      createAtaIdempotentIx(owner.publicKey, owner.publicKey, mint.publicKey, ata),
      mintToIx(
        mint.publicKey,
        ata,
        owner.publicKey,
        SUPPLY * 10n ** BigInt(DEFAULT_STOCK_DECIMALS),
      ),
    );

    try {
      const sig = await sendAndConfirmTransaction(conn, tx, [owner, mint], {
        commitment: config.commitment,
      });
      created[stock.symbol] = mint.publicKey.toBase58();
      console.log(`│ ✓ ${stock.symbol.padEnd(11)} ${mint.publicKey.toBase58()}  (${sig.slice(0, 8)}…)`);
    } catch (error) {
      console.log(`│ ✗ ${stock.symbol.padEnd(11)} ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  console.log("└───────────────────────────────────────────────────────────────────────");
  console.log("\nPaste into .env (devnet demo):\n");
  console.log(`PRAXIS_STOCKS_ENABLED=1`);
  console.log(`PRAXIS_STOCK_MINTS=${JSON.stringify(created)}`);
  console.log(
    `PRAXIS_STOCK_DECIMALS=${JSON.stringify(
      Object.fromEntries(Object.keys(created).map((s) => [s, DEFAULT_STOCK_DECIMALS])),
    )}`,
  );
  console.log(
    `\nOwner now holds ${SUPPLY} of each. Fund a vault with:\n` +
      `  bun run praxis:fund-stock-vault -- OPENAI 1000\n`,
  );
}

void main();
