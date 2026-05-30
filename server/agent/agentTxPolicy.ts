import bs58 from "bs58";
import { Message, PublicKey } from "@solana/web3.js";

import { INSTRUCTION_DISCRIMINATOR } from "../aegis/constants";

const AGENT_TRANSFER_DISCRIMINATORS = [
  INSTRUCTION_DISCRIMINATOR.agentTransfer,
  INSTRUCTION_DISCRIMINATOR.agentTransferSpl,
];

/**
 * Decide whether a serialized transaction message is a single Aegis
 * `agent_transfer` / `agent_transfer_spl` instruction to `programId`. This is
 * the signer service's custody policy: it signs only agent transfers to the
 * configured Aegis program, nothing else. Pure and shared so it is unit-tested
 * alongside the rest of the codebase. The on-chain program remains the
 * authoritative enforcement; this is defense in depth at the key boundary.
 */
export function isAegisAgentTransferMessage(
  messageBytes: Uint8Array,
  programId: PublicKey,
): boolean {
  let message: Message;
  try {
    message = Message.from(messageBytes);
  } catch {
    return false;
  }

  if (message.instructions.length !== 1) return false;

  const [instruction] = message.instructions;
  const instructionProgramId = message.accountKeys[instruction.programIdIndex];
  if (!instructionProgramId || !instructionProgramId.equals(programId)) return false;

  let data: Uint8Array;
  try {
    data = bs58.decode(instruction.data);
  } catch {
    return false;
  }
  if (data.length < 8) return false;

  const discriminator = Buffer.from(data.subarray(0, 8));
  return AGENT_TRANSFER_DISCRIMINATORS.some((known) => discriminator.equals(known));
}
