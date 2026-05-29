import { PublicKey } from "@solana/web3.js";
import {
  AEGIS_IDL_JSON,
  type AegisInstructionName,
  type RejectReason,
  RejectReason as AegisRejectReason,
} from "@praxis/shared";

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
  agentTransfer: instructionDiscriminator("agent_transfer"),
  fundVault: instructionDiscriminator("fund_vault"),
  initializePolicy: instructionDiscriminator("initialize_policy"),
  revokeAgent: instructionDiscriminator("revoke_agent"),
  rotateAgent: instructionDiscriminator("rotate_agent"),
  updatePolicy: instructionDiscriminator("update_policy"),
  withdrawVault: instructionDiscriminator("withdraw_vault"),
} satisfies Record<AegisInstructionName, Buffer>;

export const ACCOUNT_DISCRIMINATOR = {
  policyAccount: accountDiscriminator("PolicyAccount"),
  actionLog: accountDiscriminator("ActionLog"),
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

function instructionDiscriminator(idlName: string): Buffer {
  const instruction = AEGIS_IDL_JSON.instructions.find((item) => item.name === idlName);
  if (!instruction) throw new Error(`Aegis IDL missing instruction ${idlName}`);
  return Buffer.from(instruction.discriminator);
}

function accountDiscriminator(idlName: string): Buffer {
  const account = AEGIS_IDL_JSON.accounts.find((item) => item.name === idlName);
  if (!account) throw new Error(`Aegis IDL missing account ${idlName}`);
  return Buffer.from(account.discriminator);
}
