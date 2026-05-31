import bs58 from "bs58";
import nacl from "tweetnacl";

import { PraxisConfigError } from "./errors";

/**
 * Signs the wallet-ownership challenge. Implement this to bridge any wallet:
 * - Node / backend agents: use {@link keypairSigner} with a secret key.
 * - Browser: wrap a wallet-adapter, e.g.
 *   `{ address: wallet.publicKey.toBase58(), signMessage: (m) => wallet.signMessage(m) }`.
 *
 * `signMessage` must return the raw 64-byte Ed25519 signature; the SDK base58-
 * encodes it for the API.
 */
export interface PraxisSigner {
  /** base58-encoded Solana public key. */
  readonly address: string;
  signMessage(message: Uint8Array): Promise<Uint8Array> | Uint8Array;
}

export type SecretKeyInput = Uint8Array | number[] | string;

/**
 * Build a {@link PraxisSigner} from a Solana secret key — a 64-byte keypair or a
 * 32-byte seed, as raw bytes, a number array, or a base58 string (Phantom /
 * `solana-keygen` export). Node and browser friendly; no `@solana/web3.js`
 * dependency.
 */
export function keypairSigner(secret: SecretKeyInput): PraxisSigner {
  const bytes = normalizeSecret(secret);
  const pair =
    bytes.length === 64
      ? nacl.sign.keyPair.fromSecretKey(bytes)
      : nacl.sign.keyPair.fromSeed(bytes);
  const address = bs58.encode(pair.publicKey);
  const secretKey = pair.secretKey;

  return {
    address,
    signMessage: (message: Uint8Array) => nacl.sign.detached(message, secretKey),
  };
}

function normalizeSecret(secret: SecretKeyInput): Uint8Array {
  let bytes: Uint8Array;
  if (typeof secret === "string") {
    try {
      bytes = bs58.decode(secret.trim());
    } catch {
      throw new PraxisConfigError("secret key string must be base58-encoded");
    }
  } else if (Array.isArray(secret)) {
    bytes = Uint8Array.from(secret);
  } else {
    bytes = secret;
  }

  if (bytes.length !== 64 && bytes.length !== 32) {
    throw new PraxisConfigError(
      `secret key must be 64 bytes (keypair) or 32 bytes (seed), got ${bytes.length}`,
    );
  }
  return bytes;
}
