import { createPublicKey, randomBytes, verify } from "node:crypto";

import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

import { PraxisAuthError, PraxisInputError } from "../errors";
import { normalizeWallet } from "./session";

interface StoredChallenge {
  address: string;
  message: string;
  origin: string;
  issuedAt: number;
  expiresAt: number;
}

export interface WalletChallenge {
  address: string;
  nonce: string;
  message: string;
  expiresAt: string;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGES = 1_000;
const challenges = new Map<string, StoredChallenge>();

export function createWalletChallenge(address: string, request: Request): WalletChallenge {
  pruneChallenges();

  if (challenges.size >= MAX_CHALLENGES) {
    throw new PraxisAuthError("Too many pending wallet sign-in challenges. Try again shortly.");
  }

  const normalized = normalizeWallet(address);
  const now = Date.now();
  const expires = now + CHALLENGE_TTL_MS;
  const nonce = randomBytes(18).toString("base64url");
  const origin = new URL(request.url).origin;
  const message = challengeMessage({
    address: normalized,
    nonce,
    origin,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(expires).toISOString(),
  });

  challenges.set(nonce, {
    address: normalized,
    message,
    origin,
    issuedAt: Math.floor(now / 1000),
    expiresAt: Math.floor(expires / 1000),
  });

  return {
    address: normalized,
    nonce,
    message,
    expiresAt: new Date(expires).toISOString(),
  };
}

export function verifyWalletChallenge(args: {
  address: string;
  nonce: string;
  signature: string;
}, request: Request): string {
  const address = normalizeWallet(args.address);
  const nonce = args.nonce.trim();
  if (!nonce) throw new PraxisInputError("nonce is required");

  const challenge = challenges.get(nonce);
  challenges.delete(nonce);

  if (!challenge) {
    throw new PraxisAuthError("Wallet sign-in challenge is missing or already used.");
  }
  if (challenge.address !== address) {
    throw new PraxisAuthError("Wallet sign-in challenge address does not match.");
  }
  if (challenge.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new PraxisAuthError("Wallet sign-in challenge expired.");
  }
  if (challenge.origin !== new URL(request.url).origin) {
    throw new PraxisAuthError("Wallet sign-in challenge origin does not match.");
  }

  const signature = decodeSignature(args.signature);
  const publicKey = new PublicKey(address);
  if (!verifyEd25519(publicKey, Buffer.from(challenge.message, "utf8"), signature)) {
    throw new PraxisAuthError("Wallet signature did not verify.");
  }

  return address;
}

function challengeMessage(args: {
  address: string;
  nonce: string;
  origin: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    "Praxis wants you to sign in with your Solana wallet.",
    "",
    "This proves wallet ownership and creates a web session.",
    "It does not authorize a transaction or move funds.",
    "",
    `Domain: ${new URL(args.origin).host}`,
    `URI: ${args.origin}/app`,
    `Wallet: ${args.address}`,
    `Nonce: ${args.nonce}`,
    "Version: 1",
    `Issued At: ${args.issuedAt}`,
    `Expires At: ${args.expiresAt}`,
  ].join("\n");
}

function decodeSignature(value: string): Buffer {
  try {
    const decoded = Buffer.from(bs58.decode(value.trim()));
    if (decoded.length !== 64) throw new Error("signature must be 64 bytes");
    return decoded;
  } catch {
    throw new PraxisInputError("signature must be a base58-encoded Ed25519 signature");
  }
}

function verifyEd25519(publicKey: PublicKey, message: Buffer, signature: Buffer): boolean {
  const spki = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    publicKey.toBuffer(),
  ]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  return verify(null, message, key, signature);
}

function pruneChallenges() {
  const now = Math.floor(Date.now() / 1000);
  for (const [nonce, challenge] of challenges) {
    if (challenge.expiresAt <= now) challenges.delete(nonce);
  }
}
