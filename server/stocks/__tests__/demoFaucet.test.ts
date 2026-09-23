import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";

import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "../../aegis/constants";
import { findAssociatedTokenAddress } from "../../aegis/pdas";
import { demoMintInstructions, isMintAuthority } from "../demoFaucet";

function mintData(authority: Keypair | null): Uint8Array {
  const data = Buffer.alloc(82);
  if (authority) {
    data.writeUInt32LE(1, 0);
    authority.publicKey.toBuffer().copy(data, 4);
  }
  return data;
}

describe("isMintAuthority", () => {
  test("recognizes the key in the mint-authority slot, and nothing else", () => {
    const faucet = Keypair.generate();
    expect(isMintAuthority(mintData(faucet), faucet.publicKey)).toBe(true);
    expect(isMintAuthority(mintData(Keypair.generate()), faucet.publicKey)).toBe(false);
    // A mint whose authority was dropped (COption::None) can be minted by nobody.
    expect(isMintAuthority(mintData(null), faucet.publicKey)).toBe(false);
    expect(isMintAuthority(new Uint8Array(10), faucet.publicKey)).toBe(false);
  });
});

describe("demoMintInstructions", () => {
  test("creates both token accounts at the faucet's expense, then mints into the vault's", () => {
    const [faucet, owner, vault, mint] = [0, 1, 2, 3].map(() => Keypair.generate().publicKey);
    const ixs = demoMintInstructions({
      faucet,
      owner,
      vault,
      mint,
      tokenProgramId: TOKEN_2022_PROGRAM_ID,
      amount: 768_000_000n,
    });
    expect(ixs).toHaveLength(3);
    const [createVault, createOwner, mintTo] = ixs;
    for (const [ix, holder] of [[createVault, vault], [createOwner, owner]] as const) {
      expect(ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
      expect(ix.keys[0].pubkey.equals(faucet)).toBe(true);
      expect(ix.keys[2].pubkey.equals(holder)).toBe(true);
    }
    const vaultAta = findAssociatedTokenAddress(vault, mint, TOKEN_2022_PROGRAM_ID);
    expect(mintTo.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(mintTo.keys.map((k) => k.pubkey.toBase58())).toEqual([
      mint.toBase58(),
      vaultAta.toBase58(),
      faucet.toBase58(),
    ]);
    expect(mintTo.keys[2].isSigner).toBe(true);
    expect(mintTo.data[0]).toBe(7);
    expect(mintTo.data.readBigUInt64LE(1)).toBe(768_000_000n);
  });
});
