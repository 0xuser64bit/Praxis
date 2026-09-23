import { PublicKey, type TransactionInstruction } from "@solana/web3.js";

import { buildCreateAssociatedTokenAccountIdempotentIx, buildMintToIx } from "../aegis/instructions";
import { findAssociatedTokenAddress } from "../aegis/pdas";

/**
 * Devnet demo faucet.
 *
 * The real PreStocks mints are mainnet-only, so a devnet deployment runs on
 * mirror mints the operator created — and only the operator's wallet ever
 * held any. Anyone connecting their own wallet could configure an envelope
 * and read a proposal, but never complete a buy: their vault had no stock.
 * This mints a fixed dollar amount of the active mirror stock into the
 * signed-in wallet's vault, creating the vault's and the owner's token
 * accounts on the way.
 *
 * Three independent guards keep it a demo tool: the provider refuses a mint
 * that is not a mirror, refuses a mainnet cluster by genesis hash, and
 * refuses unless the faucet key is the mint's authority — so a misconfigured
 * deployment fails with a sentence, not an on-chain error it paid for.
 */

/** Dollars of demo stock per grant, at the PreStocks price. */
export const DEMO_FAUCET_USD = 1_000;

/** Solana mainnet-beta's genesis hash. The faucet never runs there. */
export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export interface DemoStockGrant {
  symbol: string;
  /** Base units minted into the vault. */
  amount: bigint;
  decimals: number;
  usd: number;
  sig: string;
}

/**
 * True when `mintData` (a SPL Token or Token-2022 mint account) names
 * `authority` as its mint authority. The base layout is shared by both
 * programs: a `COption<Pubkey>` — u32 tag, then the key — at offset 0.
 */
export function isMintAuthority(mintData: Uint8Array, authority: PublicKey): boolean {
  if (mintData.length < 36) return false;
  const tag = Buffer.from(mintData.subarray(0, 4)).readUInt32LE(0);
  return tag === 1 && new PublicKey(mintData.subarray(4, 36)).equals(authority);
}

/** Create the vault's and owner's ATAs (idempotent, faucet pays), then mint into the vault's. */
export function demoMintInstructions(args: {
  faucet: PublicKey;
  owner: PublicKey;
  vault: PublicKey;
  mint: PublicKey;
  tokenProgramId: PublicKey;
  amount: bigint;
}): TransactionInstruction[] {
  const ata = (owner: PublicKey) => findAssociatedTokenAddress(owner, args.mint, args.tokenProgramId);
  const create = (owner: PublicKey) =>
    buildCreateAssociatedTokenAccountIdempotentIx({
      payer: args.faucet,
      owner,
      mint: args.mint,
      ata: ata(owner),
      tokenProgramId: args.tokenProgramId,
    });
  return [
    create(args.vault),
    create(args.owner),
    buildMintToIx({
      mint: args.mint,
      destination: ata(args.vault),
      authority: args.faucet,
      amount: args.amount,
      tokenProgramId: args.tokenProgramId,
    }),
  ];
}
