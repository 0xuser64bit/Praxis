import { describe, expect, test } from "bun:test";
import { createPublicKey, verify } from "node:crypto";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import { createSignerHandler } from "../handler";
import { buildAgentTransferIx } from "../../server/aegis/instructions";
import { DEFAULT_AEGIS_PROGRAM_ID } from "../../server/aegis/constants";

const TOKEN = "signer-secret-token";
const BLOCKHASH = Keypair.generate().publicKey.toBase58();

function handler(keypair = Keypair.generate()) {
  return {
    keypair,
    handle: createSignerHandler({ keypair, programId: DEFAULT_AEGIS_PROGRAM_ID, token: TOKEN }),
  };
}

function agentTransferMessage(agent: PublicKey): string {
  const ix = buildAgentTransferIx(
    {
      programId: DEFAULT_AEGIS_PROGRAM_ID,
      policy: Keypair.generate().publicKey,
      vault: Keypair.generate().publicKey,
      actionLog: Keypair.generate().publicKey,
      agentAuthority: agent,
    },
    Keypair.generate().publicKey,
    1n,
  );
  const tx = new Transaction({ feePayer: agent, blockhash: BLOCKHASH, lastValidBlockHeight: 1 }).add(ix);
  return tx.serializeMessage().toString("base64");
}

function signRequest(message: string, token = TOKEN): Request {
  return new Request("http://signer.local/sign", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

describe("signer handler", () => {
  test("signs a valid agent_transfer and the signature verifies", async () => {
    const { keypair, handle } = handler();
    const message = agentTransferMessage(keypair.publicKey);
    const res = await handle(signRequest(message));
    expect(res.status).toBe(200);
    const { signature } = (await res.json()) as { signature: string };

    // The returned signature must be a valid ed25519 signature by the agent key
    // over the exact message bytes.
    expect(
      verifyEd25519(keypair.publicKey, Buffer.from(message, "base64"), Buffer.from(signature, "base64")),
    ).toBe(true);
  });

  test("rejects a missing/!wrong bearer token", async () => {
    const { keypair, handle } = handler();
    const message = agentTransferMessage(keypair.publicKey);
    expect((await handle(signRequest(message, "wrong"))).status).toBe(401);
    const noAuth = new Request("http://signer.local/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    expect((await handle(noAuth)).status).toBe(401);
  });

  test("refuses to sign a non-Aegis message (policy)", async () => {
    const { keypair, handle } = handler();
    const agent = keypair.publicKey;
    const tx = new Transaction({ feePayer: agent, blockhash: BLOCKHASH, lastValidBlockHeight: 1 }).add(
      SystemProgram.transfer({ fromPubkey: agent, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
    );
    const res = await handle(signRequest(tx.serializeMessage().toString("base64")));
    expect(res.status).toBe(403);
  });

  test("400s on a missing message", async () => {
    const { handle } = handler();
    const res = await handle(
      new Request("http://signer.local/sign", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("health check returns the agent address", async () => {
    const { keypair, handle } = handler();
    const res = await handle(new Request("http://signer.local/"));
    expect(res.status).toBe(200);
    expect((await res.json()).agent).toBe(keypair.publicKey.toBase58());
  });
});

function verifyEd25519(publicKey: PublicKey, message: Uint8Array, signature: Uint8Array): boolean {
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey.toBuffer()]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  return verify(null, Buffer.from(message), key, Buffer.from(signature));
}
