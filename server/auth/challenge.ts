import { createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";

import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

import { PraxisAuthError, PraxisInputError } from "../errors";
import { errorFields, logger } from "../observability/logger";
import { getNonceStore } from "./nonceStore";
import { normalizeWallet, signWithSessionSecret } from "./session";

interface ChallengePayload {
  v: 1;
  address: string;
  origin: string;
  nonceId: string;
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

export function createWalletChallenge(address: string, request: Request): WalletChallenge {
  const normalized = normalizeWallet(address);
  const now = Date.now();
  const expires = now + CHALLENGE_TTL_MS;
  const origin = new URL(request.url).origin;
  const payload: ChallengePayload = {
    v: 1,
    address: normalized,
    origin,
    nonceId: randomBytes(18).toString("base64url"),
    issuedAt: Math.floor(now / 1000),
    expiresAt: Math.floor(expires / 1000),
  };
  const nonce = signChallengePayload(payload);
  const message = challengeMessage(payload, nonce);

  return {
    address: normalized,
    nonce,
    message,
    expiresAt: new Date(expires).toISOString(),
  };
}

export async function verifyWalletChallenge(args: {
  address: string;
  nonce: string;
  signature: string;
}, request: Request): Promise<string> {
  const address = normalizeWallet(args.address);
  const nonce = args.nonce.trim();
  if (!nonce) throw new PraxisInputError("nonce is required");
  if (nonce.length > 512) throw new PraxisInputError("nonce is too long");

  const challenge = verifyChallengePayload(nonce);
  if (!challenge) {
    throw new PraxisAuthError("Wallet sign-in challenge is missing or already used.");
  }
  if (challenge.address !== address) {
    throw new PraxisAuthError("Wallet sign-in challenge address does not match.");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (challenge.expiresAt <= nowSeconds) {
    throw new PraxisAuthError("Wallet sign-in challenge expired.");
  }
  if (challenge.origin !== new URL(request.url).origin) {
    throw new PraxisAuthError("Wallet sign-in challenge origin does not match.");
  }

  const signature = decodeSignature(args.signature);
  const publicKey = new PublicKey(address);
  if (!verifyEd25519(publicKey, Buffer.from(challengeMessage(challenge, nonce), "utf8"), signature)) {
    throw new PraxisAuthError("Wallet signature did not verify.");
  }

  // Burn the nonce LAST, and only after the signature verifies, so a bad
  // signature cannot be used to consume someone else's pending challenge.
  // The claim is atomic in the store, so of two concurrent replays exactly
  // one wins — the check-then-set this replaced had a race between them.
  await consumeNonce(nonce, Math.max(1, challenge.expiresAt - nowSeconds));
  return address;
}

/** Claim a nonce, failing closed if the shared store cannot answer. */
async function consumeNonce(nonce: string, ttlSeconds: number): Promise<void> {
  let claimed: boolean;
  try {
    claimed = await getNonceStore().consume(nonce, ttlSeconds);
  } catch (error) {
    // A replay guard that fails open is not a replay guard. Refuse the
    // sign-in and let the client retry rather than accept a signature we
    // cannot prove is being redeemed for the first time.
    logger.warn("auth.nonce_store_unavailable", errorFields(error));
    throw new PraxisAuthError("Wallet sign-in is temporarily unavailable. Try again shortly.");
  }
  if (!claimed) {
    throw new PraxisAuthError("Wallet sign-in challenge is missing or already used.");
  }
}

function challengeMessage(args: ChallengePayload, nonce: string): string {
  return [
    "Praxis wants you to sign in with your Solana wallet.",
    "",
    "This proves wallet ownership and creates a web session.",
    "It does not authorize a transaction or move funds.",
    "",
    `Domain: ${new URL(args.origin).host}`,
    `URI: ${args.origin}/app`,
    `Wallet: ${args.address}`,
    `Nonce: ${nonce}`,
    "Version: 1",
    `Issued At: ${new Date(args.issuedAt * 1000).toISOString()}`,
    `Expires At: ${new Date(args.expiresAt * 1000).toISOString()}`,
  ].join("\n");
}

function signChallengePayload(payload: ChallengePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signWithSessionSecret(encoded)}`;
}

function verifyChallengePayload(token: string): ChallengePayload | null {
  const [encoded, sig, extra] = token.split(".");
  if (!encoded || !sig || extra !== undefined) return null;
  if (!safeEqual(sig, signWithSessionSecret(encoded))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<ChallengePayload>;
    if (parsed.v !== 1) return null;
    if (typeof parsed.address !== "string") return null;
    if (typeof parsed.origin !== "string") return null;
    if (typeof parsed.nonceId !== "string") return null;
    if (typeof parsed.issuedAt !== "number" || !Number.isSafeInteger(parsed.issuedAt)) return null;
    if (typeof parsed.expiresAt !== "number" || !Number.isSafeInteger(parsed.expiresAt)) return null;
    return {
      v: 1,
      address: normalizeWallet(parsed.address),
      origin: parsed.origin,
      nonceId: parsed.nonceId,
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
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

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
