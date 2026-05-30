import { describe, expect, test } from "bun:test";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";

import { AegisClient } from "../client";
import { DEFAULT_AEGIS_PROGRAM_ID } from "../constants";
import { findPolicyPda } from "../pdas";
import { PraxisConfigError } from "../../errors";
import { DEFAULT_TOKENS, type PraxisServerConfig } from "../../env";
import type { AgentSigner } from "../../agent/agentSigner";
import { encodePolicyAccount, policyFixture } from "../../testing/fixtures";

const BLOCKHASH = Keypair.generate().publicKey.toBase58(); // valid 32-byte base58

function fakeConnection(over: Partial<Record<string, unknown>> = {}): Connection {
  return {
    getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 321 }),
    sendRawTransaction: async () => "owner-sig",
    confirmTransaction: async () => ({ value: { err: null } }),
    ...over,
  } as unknown as Connection;
}

function makeConfig(over: Partial<PraxisServerConfig> = {}): PraxisServerConfig {
  const owner = Keypair.generate();
  const agent = Keypair.generate();
  const nextAgent = Keypair.generate();
  return {
    rpcUrl: "http://127.0.0.1:8899",
    commitment: "confirmed",
    programId: DEFAULT_AEGIS_PROGRAM_ID,
    ownerAddress: owner.publicKey,
    agentKeypair: agent,
    nextAgentKeypair: nextAgent,
    policyAddress: findPolicyPda(owner.publicKey, DEFAULT_AEGIS_PROGRAM_ID),
    addressBook: [],
    tokens: DEFAULT_TOKENS,
    ...over,
  };
}

describe("buildUnsignedOwnerTransaction", () => {
  test("builds an unsigned revoke tx with the wallet as fee payer and sole signer", async () => {
    const config = makeConfig();
    const wallet = config.ownerAddress!;
    const client = new AegisClient(config, fakeConnection());

    const draft = await client.buildUnsignedOwnerTransaction(wallet, { kind: "revoke" });
    expect(draft.blockhash).toBe(BLOCKHASH);
    expect(draft.lastValidBlockHeight).toBe(321);

    const tx = Transaction.from(Uint8Array.from(Buffer.from(draft.transaction, "base64")));
    expect(tx.feePayer?.equals(wallet)).toBe(true);
    expect(tx.instructions).toHaveLength(1);
    expect(tx.instructions[0].programId.equals(DEFAULT_AEGIS_PROGRAM_ID)).toBe(true);
    const ownerKey = tx.instructions[0].keys.find((k) => k.pubkey.equals(wallet));
    expect(ownerKey?.isSigner).toBe(true);
    // Unsigned: no real signatures yet.
    expect(tx.signatures.every((s) => s.signature === null)).toBe(true);
  });

  test("builds a rotate tx that sets the configured next agent authority", async () => {
    const config = makeConfig();
    const client = new AegisClient(config, fakeConnection());
    const draft = await client.buildUnsignedOwnerTransaction(config.ownerAddress!, { kind: "rotate" });
    const tx = Transaction.from(Uint8Array.from(Buffer.from(draft.transaction, "base64")));
    const data = tx.instructions[0].data;
    // rotate ix payload = 8-byte discriminator + 32-byte new agent pubkey.
    const embedded = new PublicKey(data.subarray(8, 40));
    expect(embedded.equals(config.nextAgentKeypair!.publicKey)).toBe(true);
  });

  test("refuses to rotate to the current agent key", async () => {
    const agent = Keypair.generate();
    const config = makeConfig({ agentKeypair: agent, nextAgentKeypair: agent });
    const client = new AegisClient(config, fakeConnection());
    await expect(
      client.buildUnsignedOwnerTransaction(config.ownerAddress!, { kind: "rotate" }),
    ).rejects.toBeInstanceOf(PraxisConfigError);
  });
});

describe("execute uses the AgentSigner", () => {
  test("executeAgentTransfer invokes the injected signer and confirms", async () => {
    const agent = Keypair.generate();
    let signCalls = 0;
    const signer: AgentSigner = {
      publicKey: agent.publicKey,
      async signTransaction(tx) {
        signCalls += 1;
        tx.sign(agent);
        return tx;
      },
    };

    const config = makeConfig({ agentKeypair: undefined }); // signer is injected, no local key
    const policyData = encodePolicyAccount(policyFixture({ address: config.policyAddress!.toBase58() }));
    const conn = fakeConnection({
      getAccountInfo: async () => ({ data: policyData, owner: DEFAULT_AEGIS_PROGRAM_ID, lamports: 1, executable: false }),
      getBalance: async () => 100_000_000_000,
      getSlot: async () => 1,
      getBlockTime: async () => Math.floor(Date.now() / 1000),
      getTransaction: async () => ({ meta: { logMessages: [] } }),
    });
    const client = new AegisClient(config, conn, signer);

    const result = await client.executeAgentTransfer(Keypair.generate().publicKey, 1_000_000n);
    expect(signCalls).toBe(1);
    expect(result.status).toBe("confirmed");
    expect(result.sig).toBe("owner-sig");
  });
});

describe("submitSignedTransaction", () => {
  const input = { transaction: "AQID", blockhash: BLOCKHASH, lastValidBlockHeight: 321 };

  test("returns the signature on a confirmed transaction", async () => {
    const client = new AegisClient(makeConfig(), fakeConnection());
    expect(await client.submitSignedTransaction(input)).toBe("owner-sig");
  });

  test("throws when the cluster reports an error", async () => {
    const client = new AegisClient(
      makeConfig(),
      fakeConnection({ confirmTransaction: async () => ({ value: { err: { InstructionError: [0, "Custom"] } } }) }),
    );
    await expect(client.submitSignedTransaction(input)).rejects.toThrow(/owner transaction failed/);
  });
});
