import bs58 from "bs58";
import { Message, PublicKey } from "@solana/web3.js";

import { INSTRUCTION_DISCRIMINATOR } from "../aegis/constants";

const AGENT_TRANSFER_INSTRUCTIONS = [
  { name: "agent_transfer" as const, discriminator: INSTRUCTION_DISCRIMINATOR.agentTransfer },
  { name: "agent_transfer_spl" as const, discriminator: INSTRUCTION_DISCRIMINATOR.agentTransferSpl },
];

/**
 * What a signable message is asking the agent key to do. `policy` and `amount`
 * are read out so the key boundary can record what it signed: the signer is
 * the one component that sees every agent signature, and an audit trail that
 * only says "a request was signed" cannot answer the question anyone asks
 * after an incident, which is "signed for whom, and for how much".
 *
 * Both instructions put the policy PDA at account index 1 and encode their
 * amount as a u64 immediately after the 8-byte discriminator.
 */
export interface AegisAgentTransfer {
  instruction: "agent_transfer" | "agent_transfer_spl";
  policy: string;
  amount: bigint;
}

const POLICY_ACCOUNT_INDEX = 1;
const DISCRIMINATOR_LEN = 8;

/**
 * Decode a serialized transaction message as a single Aegis agent transfer to
 * `programId`, or return null. This is the signer service's custody policy: it
 * signs only agent transfers to the configured Aegis program, nothing else.
 * Pure and shared so it is unit-tested alongside the rest of the codebase. The
 * on-chain program remains the authoritative enforcement; this is defense in
 * depth at the key boundary.
 */
export function describeAegisAgentTransfer(
  messageBytes: Uint8Array,
  programId: PublicKey,
): AegisAgentTransfer | null {
  let message: Message;
  try {
    message = Message.from(messageBytes);
  } catch {
    return null;
  }

  if (message.instructions.length !== 1) return null;

  const [instruction] = message.instructions;
  const instructionProgramId = message.accountKeys[instruction.programIdIndex];
  if (!instructionProgramId || !instructionProgramId.equals(programId)) return null;

  let data: Uint8Array;
  try {
    data = bs58.decode(instruction.data);
  } catch {
    return null;
  }
  if (data.length < DISCRIMINATOR_LEN + 8) return null;

  const discriminator = Buffer.from(data.subarray(0, DISCRIMINATOR_LEN));
  const known = AGENT_TRANSFER_INSTRUCTIONS.find((item) => discriminator.equals(item.discriminator));
  if (!known) return null;

  const policy = message.accountKeys[instruction.accounts[POLICY_ACCOUNT_INDEX]];
  if (!policy) return null;

  return {
    instruction: known.name,
    policy: policy.toBase58(),
    amount: Buffer.from(data.subarray(DISCRIMINATOR_LEN, DISCRIMINATOR_LEN + 8)).readBigUInt64LE(0),
  };
}
