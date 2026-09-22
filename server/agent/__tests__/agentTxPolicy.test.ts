import { describe, expect, test } from "bun:test";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";

import { describeAegisAgentTransfer } from "../agentTxPolicy";
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

describe("describeAegisAgentTransfer", () => {
  const agent = Keypair.generate().publicKey;

  test("describes a single agent_transfer to the Aegis program", () => {
    const addr = addresses();
    const ix = buildAgentTransferIx({ ...addr, agentAuthority: agent }, Keypair.generate().publicKey, 7n);
    // The policy and amount are what the key boundary records, so they have to
    // be read off the message rather than trusted from the caller.
    expect(describeAegisAgentTransfer(messageOf(ix), DEFAULT_AEGIS_PROGRAM_ID)).toEqual({
      instruction: "agent_transfer",
      policy: addr.policy.toBase58(),
      amount: 7n,
    });
  });

  test("describes a single agent_transfer_spl", () => {
    const addr = addresses();
    const ix = buildAgentTransferSplIx(
      { ...addr, agentAuthority: agent },
      {
        vaultTokenAccount: Keypair.generate().publicKey,
        recipientTokenAccount: Keypair.generate().publicKey,
        mint: Keypair.generate().publicKey,
      },
      5n,
    );
    expect(describeAegisAgentTransfer(messageOf(ix), DEFAULT_AEGIS_PROGRAM_ID)).toEqual({
      instruction: "agent_transfer_spl",
      policy: addr.policy.toBase58(),
      amount: 5n,
    });
  });

  test("rejects a different program id", () => {
    const ix = buildAgentTransferIx({ ...addresses(), agentAuthority: agent }, Keypair.generate().publicKey, 1n);
    expect(describeAegisAgentTransfer(messageOf(ix), Keypair.generate().publicKey)).toBeNull();
  });

  test("rejects a non-Aegis instruction (a plain SOL transfer)", () => {
    const ix = SystemProgram.transfer({
      fromPubkey: agent,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    });
    expect(describeAegisAgentTransfer(messageOf(ix), DEFAULT_AEGIS_PROGRAM_ID)).toBeNull();
  });

  test("rejects a multi-instruction message (no smuggling extra instructions)", () => {
    const transfer = buildAgentTransferIx({ ...addresses(), agentAuthority: agent }, Keypair.generate().publicKey, 1n);
    const extra = SystemProgram.transfer({ fromPubkey: agent, toPubkey: Keypair.generate().publicKey, lamports: 1 });
    expect(describeAegisAgentTransfer(messageOf(transfer, extra), DEFAULT_AEGIS_PROGRAM_ID)).toBeNull();
  });

  test("rejects garbage bytes", () => {
    expect(describeAegisAgentTransfer(new Uint8Array([1, 2, 3]), DEFAULT_AEGIS_PROGRAM_ID)).toBeNull();
  });
});
