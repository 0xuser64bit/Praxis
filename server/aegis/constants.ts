import { PublicKey } from "@solana/web3.js";
import { type RejectReason, RejectReason as AegisRejectReason } from "@praxis/shared";

export const DEFAULT_AEGIS_PROGRAM_ID = new PublicKey(
  "7qRKV1dNPCixKWDLHsuHa5puFsNPtNCzC1sX6P1kpFgb",
);

export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

export const SEEDS = {
  policy: Buffer.from("policy"),
  vault: Buffer.from("vault"),
  actionLog: Buffer.from("action_log"),
};

export const INSTRUCTION_DISCRIMINATOR = {
  agentTransfer: Buffer.from([199, 111, 151, 49, 124, 13, 150, 44]),
  fundVault: Buffer.from([26, 33, 207, 242, 119, 108, 134, 73]),
  initializePolicy: Buffer.from([9, 186, 86, 225, 129, 162, 231, 56]),
  revokeAgent: Buffer.from([227, 60, 209, 125, 240, 117, 163, 73]),
  rotateAgent: Buffer.from([182, 91, 147, 107, 155, 47, 150, 176]),
  updatePolicy: Buffer.from([212, 245, 246, 7, 163, 151, 18, 57]),
  withdrawVault: Buffer.from([135, 7, 237, 120, 149, 94, 95, 7]),
} as const;

export const ACCOUNT_DISCRIMINATOR = {
  policyAccount: Buffer.from([218, 201, 183, 164, 156, 127, 81, 175]),
  actionLog: Buffer.from([21, 124, 15, 134, 245, 104, 185, 20]),
} as const;

export const ACTION_LOG_CAP = 32;
export const KIND_TRANSFER = 0;
export const RESULT_REJECTED = 0;
export const RESULT_ALLOWED = 1;

const ANCHOR_ERROR_OFFSET = 6000;

export const AEGIS_ERROR_CODE_TO_REASON: Record<number, RejectReason> = {
  [ANCHOR_ERROR_OFFSET + 0]: AegisRejectReason.Unauthorized,
  [ANCHOR_ERROR_OFFSET + 1]: AegisRejectReason.Paused,
  [ANCHOR_ERROR_OFFSET + 2]: AegisRejectReason.Expired,
  [ANCHOR_ERROR_OFFSET + 3]: AegisRejectReason.OverPerTx,
  [ANCHOR_ERROR_OFFSET + 4]: AegisRejectReason.OverDaily,
  [ANCHOR_ERROR_OFFSET + 5]: AegisRejectReason.RecipientNotAllowed,
  [ANCHOR_ERROR_OFFSET + 6]: AegisRejectReason.Overflow,
};

export const AEGIS_OPERATIONAL_ERROR: Record<number, string> = {
  [ANCHOR_ERROR_OFFSET + 7]: "too many allowed programs",
  [ANCHOR_ERROR_OFFSET + 8]: "too many allowed recipients",
  [ANCHOR_ERROR_OFFSET + 9]: "too many allowed mints",
  [ANCHOR_ERROR_OFFSET + 10]: "invalid policy limits",
  [ANCHOR_ERROR_OFFSET + 11]: "vault has insufficient balance",
};

export function reasonFromAegisErrorCode(code: number): RejectReason | undefined {
  return AEGIS_ERROR_CODE_TO_REASON[code];
}
