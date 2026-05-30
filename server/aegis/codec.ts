import { PublicKey } from "@solana/web3.js";
import {
  ActionKind,
  type ActionLogEntry,
  type PolicyView,
  type RejectReason,
} from "@praxis/shared";

import {
  ACCOUNT_DISCRIMINATOR,
  ACTION_LOG_CAP,
  KIND_TRANSFER,
  KIND_TRANSFER_SPL,
  RESULT_ALLOWED,
  RESULT_REJECTED,
} from "./constants";

class Cursor {
  private offset = 0;

  constructor(private readonly data: Buffer) {}

  bytes(len: number): Buffer {
    const end = this.offset + len;
    if (end > this.data.length) throw new RangeError("Aegis account data is truncated");
    const out = this.data.subarray(this.offset, end);
    this.offset = end;
    return out;
  }

  u8(): number {
    return this.bytes(1).readUInt8(0);
  }

  u16(): number {
    return this.bytes(2).readUInt16LE(0);
  }

  u32(): number {
    return this.bytes(4).readUInt32LE(0);
  }

  u64(): bigint {
    return this.bytes(8).readBigUInt64LE(0);
  }

  i64(): number {
    const value = this.bytes(8).readBigInt64LE(0);
    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber)) {
      throw new RangeError(`Aegis i64 ${value.toString()} exceeds safe JS integer range`);
    }
    return asNumber;
  }

  pubkey(): string {
    return new PublicKey(this.bytes(32)).toBase58();
  }

  pubkeyVec(): string[] {
    const len = this.u32();
    const out: string[] = [];
    for (let i = 0; i < len; i++) out.push(this.pubkey());
    return out;
  }
}

function assertDiscriminator(data: Buffer, expected: Buffer, name: string) {
  if (data.length < 8 || !data.subarray(0, 8).equals(expected)) {
    throw new Error(`account is not an Aegis ${name}`);
  }
}

export function decodePolicyAccount(
  address: PublicKey,
  data: Buffer,
  vaultBalance: bigint,
): PolicyView {
  assertDiscriminator(data, ACCOUNT_DISCRIMINATOR.policyAccount, "PolicyAccount");
  const c = new Cursor(data.subarray(8));

  return {
    address: address.toBase58(),
    owner: c.pubkey(),
    agentAuthority: c.pubkey(),
    maxPerTx: c.u64(),
    dailyLimit: c.u64(),
    spentToday: c.u64(),
    dayStartTs: c.i64(),
    allowedPrograms: c.pubkeyVec(),
    allowedRecipients: c.pubkeyVec(),
    allowedMints: c.pubkeyVec(),
    expiryTs: c.i64(),
    paused: c.u8() !== 0,
    vaultBalance,
    // `bump` then the appended SPL-token envelope (see PolicyAccount in state.rs).
    ...readTokenEnvelope(c),
  };
}

/** Read `bump` + the appended SPL-token envelope fields, in struct order. */
function readTokenEnvelope(c: Cursor): {
  tokenMint: string;
  tokenMaxPerTx: bigint;
  tokenDailyLimit: bigint;
  tokenSpentToday: bigint;
  tokenDayStartTs: number;
} {
  c.u8(); // bump (declared before the token fields; not surfaced in PolicyView)
  return {
    tokenMint: c.pubkey(),
    tokenMaxPerTx: c.u64(),
    tokenDailyLimit: c.u64(),
    tokenSpentToday: c.u64(),
    tokenDayStartTs: c.i64(),
  };
}

function decodeRecord(c: Cursor): ActionLogEntry {
  const kind = c.u8();
  const amount = c.u64();
  const target = c.pubkey();
  const result = c.u8();
  const reason = c.u8();
  const ts = c.i64();

  return {
    kind: decodeKind(kind),
    amount,
    target,
    result: result === RESULT_ALLOWED ? "allowed" : "rejected",
    reasonCode: result === RESULT_REJECTED ? (reason as RejectReason) : undefined,
    ts,
  };
}

function decodeKind(kind: number): ActionKind {
  if (kind === KIND_TRANSFER) return ActionKind.Transfer;
  if (kind === KIND_TRANSFER_SPL) return ActionKind.TransferSpl;
  return kind as ActionKind;
}

export function decodeActionLog(data: Buffer): ActionLogEntry[] {
  assertDiscriminator(data, ACCOUNT_DISCRIMINATOR.actionLog, "ActionLog");
  const c = new Cursor(data.subarray(8));

  c.pubkey(); // policy
  const head = c.u16();
  const count = c.u16();
  c.u64(); // total

  const ring: ActionLogEntry[] = [];
  for (let i = 0; i < ACTION_LOG_CAP; i++) ring.push(decodeRecord(c));
  c.u8(); // bump

  const out: ActionLogEntry[] = [];
  const cappedCount = Math.min(count, ACTION_LOG_CAP);
  for (let i = 0; i < cappedCount; i++) {
    const idx = (head + ACTION_LOG_CAP - 1 - i) % ACTION_LOG_CAP;
    out.push(ring[idx]);
  }
  return out;
}

export function writeU64(value: bigint): Buffer {
  if (value < 0n || value > 2n ** 64n - 1n) {
    throw new RangeError(`u64 out of range: ${value.toString()}`);
  }
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(value, 0);
  return b;
}

export function writeI64(value: number): Buffer {
  if (!Number.isSafeInteger(value)) throw new RangeError(`i64 out of range: ${value}`);
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(value), 0);
  return b;
}

export function writePubkeyVec(values: PublicKey[]): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(values.length, 0);
  return Buffer.concat([len, ...values.map((v) => v.toBuffer())]);
}
