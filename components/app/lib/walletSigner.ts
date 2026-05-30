"use client";

import { Transaction } from "@solana/web3.js";

/**
 * A minimal owner-transaction signer backed by the injected wallet
 * (`window.solana`). Production owner/admin actions are signed by the wallet,
 * not a backend keypair — this bridges the server-built unsigned transaction to
 * the wallet's `signTransaction`. Returns null when no signing wallet is present
 * (e.g. local/devnet without a browser wallet), so callers can fall back to the
 * backend-keypair route.
 */
export interface OwnerWalletSigner {
  signTransaction(unsignedBase64: string): Promise<string>;
}

interface InjectedWallet {
  signTransaction?(tx: Transaction): Promise<Transaction>;
}

function injectedWallet(): InjectedWallet | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { solana?: InjectedWallet }).solana;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function getOwnerWalletSigner(): OwnerWalletSigner | null {
  const wallet = injectedWallet();
  if (!wallet?.signTransaction) return null;

  return {
    async signTransaction(unsignedBase64: string): Promise<string> {
      const tx = Transaction.from(base64ToBytes(unsignedBase64));
      const signed = await wallet.signTransaction!(tx);
      return bytesToBase64(signed.serialize());
    },
  };
}
