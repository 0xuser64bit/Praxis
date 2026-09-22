import { createHash, timingSafeEqual } from "node:crypto";

import { Transaction, type PublicKey } from "@solana/web3.js";

import { signWithSessionSecret } from "../auth/session";
import { PraxisInputError } from "../errors";
import { COMPUTE_BUDGET_PROGRAM_ID } from "./constants";

/**
 * Binds a wallet-signed owner transaction to the one the backend actually
 * built.
 *
 * The owner-action relay used to accept any transaction whose instructions
 * belonged to allow-listed programs, and "verified" it by comparing the
 * submitted transaction's blockhash against a blockhash the same client also
 * supplied — a check that can only ever pass. That made every server-side
 * precondition in `ownerActionInstructions` optional: a client could assemble
 * its own `close_policy` and skip the "your vault still holds tokens" refusal,
 * or its own `configure_token` and skip the movable-mint check, because the
 * relay never compared the bytes to anything it had produced.
 *
 * The draft token closes that gap without server-side state: the backend
 * fingerprints what it built, signs the fingerprint with the session secret,
 * and refuses to relay anything whose fingerprint does not match. The wallet
 * is still the only signer, and the on-chain `has_one = owner` constraint is
 * still what makes this safe — this is what makes it *coherent*.
 */

interface DraftPayload {
  v: 1;
  /** The wallet the draft was built for; re-checked against the session. */
  owner: string;
  /** Fingerprint of the instructions + fee payer + blockhash. */
  digest: string;
  /** Unix seconds. A draft outlives its blockhash by design, but not by much. */
  expiresAt: number;
}

/** Drafts are short-lived: a blockhash is valid for ~60-90s anyway. */
const DRAFT_TTL_SECONDS = 300;

export function issueOwnerDraftToken(owner: PublicKey, tx: Transaction): string {
  const payload: DraftPayload = {
    v: 1,
    owner: owner.toBase58(),
    digest: fingerprint(tx),
    expiresAt: Math.floor(Date.now() / 1000) + DRAFT_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signWithSessionSecret(encoded)}`;
}

/**
 * Throw unless `tx` is the transaction `token` was issued for, signed by
 * `owner`. Wallet-appended ComputeBudget priority-fee instructions are
 * excluded from the fingerprint — they move no funds and the fee payer is the
 * signing owner — so a wallet is free to add them.
 */
export function assertMatchesOwnerDraft(token: string, tx: Transaction, owner: PublicKey): void {
  const payload = verifyDraftToken(token);
  if (!payload) {
    throw new PraxisInputError("Owner transaction draft is missing, malformed, or not ours.");
  }
  if (payload.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new PraxisInputError("Owner transaction draft expired; build it again.");
  }
  if (payload.owner !== owner.toBase58()) {
    throw new PraxisInputError("Owner transaction draft was issued for a different wallet.");
  }
  if (!tx.feePayer || !tx.recentBlockhash) {
    throw new PraxisInputError("Signed owner transaction is missing its fee payer or blockhash.");
  }
  if (!safeEqual(fingerprint(tx), payload.digest)) {
    throw new PraxisInputError(
      "Signed owner transaction does not match the draft Praxis built. Build the action again.",
    );
  }
}

/**
 * A stable fingerprint of what the transaction will *do*: fee payer,
 * blockhash, and every value-bearing instruction in order, with its account
 * metas and data.
 *
 * Compiling a transaction normalizes account metas — the fee payer becomes
 * writable, duplicate keys merge to the union of their flags — so a freshly
 * built transaction and the same transaction round-tripped through the wire
 * do not have identical `instructions`. Both sides are therefore fingerprinted
 * in compiled form, which is also the only form the submitted bytes have.
 */
function fingerprint(tx: Transaction): string {
  const compiled = Transaction.from(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  );
  const parts = [
    `payer:${compiled.feePayer?.toBase58() ?? ""}`,
    `blockhash:${compiled.recentBlockhash ?? ""}`,
  ];
  for (const ix of compiled.instructions) {
    if (ix.programId.equals(COMPUTE_BUDGET_PROGRAM_ID)) continue;
    const keys = ix.keys
      .map((key) => `${key.pubkey.toBase58()}:${key.isSigner ? 1 : 0}${key.isWritable ? 1 : 0}`)
      .join(",");
    parts.push(`ix:${ix.programId.toBase58()}|${keys}|${Buffer.from(ix.data).toString("base64")}`);
  }
  return createHash("sha256").update(parts.join("\n")).digest("base64url");
}

function verifyDraftToken(token: string): DraftPayload | null {
  const [encoded, sig, extra] = token.split(".");
  if (!encoded || !sig || extra !== undefined) return null;
  if (!safeEqual(sig, signWithSessionSecret(encoded))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<DraftPayload>;
    if (parsed.v !== 1) return null;
    if (typeof parsed.owner !== "string") return null;
    if (typeof parsed.digest !== "string") return null;
    if (typeof parsed.expiresAt !== "number" || !Number.isSafeInteger(parsed.expiresAt)) return null;
    return { v: 1, owner: parsed.owner, digest: parsed.digest, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
