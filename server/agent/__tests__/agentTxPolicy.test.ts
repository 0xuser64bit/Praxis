import { describe, expect, test } from "bun:test";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";

import { isAegisAgentTransferMessage } from "../agentTxPolicy";
import { buildAgentTransferIx, buildAgentTransferSplIx } from "../../aegis/instructions";
import { DEFAULT_AEGIS_PROGRAM_ID } from "../../aegis/constants";

const BLOCKHASH = Keypair.generate().publicKey.toBase58();

function addresses() {
  return {
    programId: DEFAULT_AEGIS_PROGRAM_ID,
    policy: Keypair.generate().publicKey,
    vault: Keypair.generate().publicKey,
    actionLog: Keypair.generate().publicKey,
  };
}

function messageOf(...instructions: Transaction["instructions"]): Uint8Array {
  const tx = new Transaction({ feePayer: Keypair.generate().publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 1 });
  tx.add(...instructions);
  return tx.serializeMessage();
}

describe("isAegisAgentTransferMessage", () => {
  const agent = Keypair.generate().publicKey;

  test("accepts a single agent_transfer to the Aegis program", () => {
    const ix = buildAgentTransferIx({ ...addresses(), agentAuthority: agent }, Keypair.generate().publicKey, 1n);
    expect(isAegisAgentTransferMessage(messageOf(ix), DEFAULT_AEGIS_PROGRAM_ID)).toBe(true);
  });

  test("accepts a single agent_transfer_spl", () => {
    const ix = buildAgentTransferSplIx(
      { ...addresses(), agentAuthority: agent },
      { vaultTokenAccount: Keypair.generate().publicKey, recipientTokenAccount: Keypair.generate().publicKey },
      5n,
    );
    expect(isAegisAgentTransferMessage(messageOf(ix), DEFAULT_AEGIS_PROGRAM_ID)).toBe(true);
  });

  test("rejects a different program id", () => {
    const ix = buildAgentTransferIx({ ...addresses(), agentAuthority: agent }, Keypair.generate().publicKey, 1n);
    expect(isAegisAgentTransferMessage(messageOf(ix), Keypair.generate().publicKey)).toBe(false);
  });

  test("rejects a non-Aegis instruction (a plain SOL transfer)", () => {
    const ix = SystemProgram.transfer({
      fromPubkey: agent,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    });
    expect(isAegisAgentTransferMessage(messageOf(ix), DEFAULT_AEGIS_PROGRAM_ID)).toBe(false);
  });

  test("rejects a multi-instruction message (no smuggling extra instructions)", () => {
    const transfer = buildAgentTransferIx({ ...addresses(), agentAuthority: agent }, Keypair.generate().publicKey, 1n);
    const extra = SystemProgram.transfer({ fromPubkey: agent, toPubkey: Keypair.generate().publicKey, lamports: 1 });
    expect(isAegisAgentTransferMessage(messageOf(transfer, extra), DEFAULT_AEGIS_PROGRAM_ID)).toBe(false);
  });

  test("rejects garbage bytes", () => {
    expect(isAegisAgentTransferMessage(new Uint8Array([1, 2, 3]), DEFAULT_AEGIS_PROGRAM_ID)).toBe(false);
  });
});
