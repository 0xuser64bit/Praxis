// Shared test fixtures and fakes. This file is intentionally NOT a `*.test.ts`
// file so the bun test runner does not execute it as a suite.

import { createPrivateKey, sign as edSign } from "node:crypto";

import { Keypair, PublicKey } from "@solana/web3.js";
import type { PolicyView, TokenInfo } from "@praxis/shared";

import {
  ACCOUNT_DISCRIMINATOR,
  ACTION_LOG_CAP,
} from "../aegis/constants";
import { writeI64, writePubkeyVec, writeU64 } from "../aegis/codec";

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";

/** Deterministic-ish base58 public key for fixtures. */
export function randomAddress(): string {
  return Keypair.generate().publicKey.toBase58();
}

/** Build a `Request` with optional cookie/origin/body for route+auth tests. */
export function makeRequest(
  url: string,
  opts: {
    method?: string;
    cookie?: string;
    origin?: string | null;
    body?: unknown;
    headers?: Record<string, string>;
    ip?: string;
  } = {},
): Request {
  const headers = new Headers(opts.headers);
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.origin !== undefined && opts.origin !== null) headers.set("origin", opts.origin);
  if (opts.ip) headers.set("x-forwarded-for", opts.ip);
  const hasBody = opts.body !== undefined;
  if (hasBody && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(url, {
    method: opts.method ?? (hasBody ? "POST" : "GET"),
    headers,
    body: hasBody ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
}

/** Sign a message with a Solana keypair's ed25519 seed (matches the verify side). */
export function signMessage(keypair: Keypair, message: string): Buffer {
  const seed = Buffer.from(keypair.secretKey.subarray(0, 32));
  const pkcs8 = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ]);
  const key = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  return edSign(null, Buffer.from(message, "utf8"), key);
}

export const USDC: TokenInfo = {
  symbol: "USDC",
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  decimals: 6,
  verified: true,
};

/** A permissive policy fixture; override fields per test. */
export function policyFixture(overrides: Partial<PolicyView> = {}): PolicyView {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    address: randomAddress(),
    owner: randomAddress(),
    agentAuthority: randomAddress(),
    maxPerTx: 5_000_000_000n,
    dailyLimit: 20_000_000_000n,
    spentToday: 0n,
    dayStartTs: nowSec,
    allowedPrograms: [SYSTEM_PROGRAM],
    allowedRecipients: [],
    allowedMints: [],
    expiryTs: nowSec + 3600,
    paused: false,
    vaultBalance: 100_000_000_000n,
    tokenMint: SYSTEM_PROGRAM,
    tokenMaxPerTx: 0n,
    tokenDailyLimit: 0n,
    tokenSpentToday: 0n,
    tokenDayStartTs: nowSec,
    ...overrides,
  };
}

/** Serialize a `PolicyView` into the exact on-chain Anchor/Borsh byte layout. */
export function encodePolicyAccount(policy: PolicyView): Buffer {
  const pk = (v: string) => new PublicKey(v).toBuffer();
  return Buffer.concat([
    ACCOUNT_DISCRIMINATOR.policyAccount,
    pk(policy.owner),
    pk(policy.agentAuthority),
    writeU64(policy.maxPerTx),
    writeU64(policy.dailyLimit),
    writeU64(policy.spentToday),
    writeI64(policy.dayStartTs),
    writePubkeyVec(policy.allowedPrograms.map((a) => new PublicKey(a))),
    writePubkeyVec(policy.allowedRecipients.map((a) => new PublicKey(a))),
    writePubkeyVec(policy.allowedMints.map((a) => new PublicKey(a))),
    writeI64(policy.expiryTs),
    Buffer.from([policy.paused ? 1 : 0]),
    Buffer.from([254]), // bump
    pk(policy.tokenMint),
    writeU64(policy.tokenMaxPerTx),
    writeU64(policy.tokenDailyLimit),
    writeU64(policy.tokenSpentToday),
    writeI64(policy.tokenDayStartTs),
  ]);
}

export interface RawActionRecord {
  kind: number;
  amount: bigint;
  target: string;
  mint: string;
  result: number;
  reason: number;
  ts: number;
}

function encodeActionRecord(rec: RawActionRecord): Buffer {
  return Buffer.concat([
    Buffer.from([rec.kind]),
    writeU64(rec.amount),
    new PublicKey(rec.target).toBuffer(),
    new PublicKey(rec.mint).toBuffer(),
    Buffer.from([rec.result]),
    Buffer.from([rec.reason]),
    writeI64(rec.ts),
  ]);
}

const EMPTY_RECORD: RawActionRecord = {
  kind: 0,
  amount: 0n,
  target: SYSTEM_PROGRAM,
  mint: SYSTEM_PROGRAM,
  result: 0,
  reason: 0,
  ts: 0,
};

/** Serialize an `ActionLog` ring buffer (head/count drive newest-first decode). */
export function encodeActionLog(args: {
  policy: string;
  head: number;
  count: number;
  total: bigint;
  records: RawActionRecord[];
}): Buffer {
  const ring: RawActionRecord[] = [];
  for (let i = 0; i < ACTION_LOG_CAP; i++) ring.push(args.records[i] ?? EMPTY_RECORD);
  const head = Buffer.alloc(2);
  head.writeUInt16LE(args.head, 0);
  const count = Buffer.alloc(2);
  count.writeUInt16LE(args.count, 0);
  return Buffer.concat([
    ACCOUNT_DISCRIMINATOR.actionLog,
    new PublicKey(args.policy).toBuffer(),
    head,
    count,
    writeU64(args.total),
    ...ring.map(encodeActionRecord),
    Buffer.from([255]), // bump
  ]);
}
