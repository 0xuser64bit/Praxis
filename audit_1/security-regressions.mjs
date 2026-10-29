import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";
import { Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const root = fileURLToPath(new URL("../", import.meta.url));
const jiti = createJiti(import.meta.url, {
  alias: { "@praxis/shared": `${root}shared/src/index.ts` },
  fsCache: false,
});
const { PraxisServerProvider } = await jiti.import(`${root}server/provider/praxisServer.ts`);
const { resetStateRepositoryForTests } = await jiti.import(`${root}server/provider/stateRepository.ts`);
const { getNonceStore, MemoryNonceStore, resetNonceStoreForTests } = await jiti.import(`${root}server/auth/nonceStore.ts`);
const { createSignerHandler, signEd25519 } = await jiti.import(`${root}signer/handler.ts`);
const { jsonError, readJson } = await jiti.import(`${root}server/api/json.ts`);
const { PraxisConflictError, PraxisSubmittedError } = await jiti.import(`${root}server/errors.ts`);
const { DEFAULT_AEGIS_PROGRAM_ID } = await jiti.import(`${root}server/aegis/constants.ts`);
const { DEFAULT_TOKENS } = await jiti.import(`${root}server/env.ts`);
const { policyFixture } = await jiti.import(`${root}server/testing/fixtures.ts`);
const { findPolicyPda } = await jiti.import(`${root}server/aegis/pdas.ts`);
const { createWalletChallenge, verifyWalletChallenge } = await jiti.import(`${root}server/auth/challenge.ts`);
const { buildAgentTransferIx } = await jiti.import(`${root}server/aegis/instructions.ts`);

function isolatedRepository() {
  let document;
  return {
    async load() { return structuredClone(document); },
    async save(_owner, state, expectedRev) {
      if ((document?.rev ?? 0) !== expectedRev) throw new PraxisConflictError("stale snapshot");
      document = structuredClone({ state, rev: expectedRev + 1 });
      return document.rev;
    },
    async listOwnerKeys() { return []; },
  };
}

function providerFixture() {
  const owner = Keypair.generate();
  const agent = Keypair.generate();
  const policy = policyFixture();
  const config = {
    intentProviders: [], rpcUrl: "http://127.0.0.1:8899", researchRpcUrl: "http://127.0.0.1:8899",
    commitment: "confirmed", programId: DEFAULT_AEGIS_PROGRAM_ID,
    ownerAddress: owner.publicKey, ownerKeypair: owner, agentKeypair: agent,
    policyAddress: findPolicyPda(owner.publicKey, DEFAULT_AEGIS_PROGRAM_ID),
    addressBook: [], tokens: DEFAULT_TOKENS, stocksEnabled: false,
    prestocksApiUrl: "http://127.0.0.1:1/unused", prestocksTimeoutMs: 100,
    stockUniverse: undefined, stockDecimals: {}, stockMints: {}, scheduleHourUtc: 9,
  };
  let submissions = 0;
  const fake = {
    async getPolicy() { return policy; },
    async getVaultTokenBalance() { return undefined; },
    async getActionLog() { return []; },
    async executeAgentTransfer(_recipient, _amount, options) {
      const signature = `local-submission-${submissions + 1}`;
      await options?.onSubmitted?.(signature, 1000);
      submissions += 1;
      return { status: "confirmed", sig: signature, logs: [], check: { allowed: true } };
    },
  };
  return { config, fake, submissions: () => submissions };
}

function stateWithProposal(id, recipient) {
  return {
    threads: [], activity: [], contacts: [], schedules: [], removedContacts: [],
    proposals: {
      [id]: {
        id, state: "pending", createdAt: Math.floor(Date.now() / 1000),
        check: { allowed: true },
        detail: {
          kind: "transfer", asset: DEFAULT_TOKENS[0], amount: 1n,
          recipientName: "local recipient", recipientAddress: recipient,
        },
      },
    },
  };
}

test("stale refresh cannot restore a paid proposal or allow a duplicate execution", async () => {
  const repository = isolatedRepository();
  resetStateRepositoryForTests(repository);
  const fixture = providerFixture();
  const owner = fixture.config.ownerAddress.toBase58();
  const proposalId = "local-at-most-once";
  await repository.save(owner, stateWithProposal(proposalId, Keypair.generate().publicKey.toBase58()), 0);
  const first = new PraxisServerProvider(fixture.config, fixture.fake, await repository.load(owner));
  const stale = new PraxisServerProvider(fixture.config, fixture.fake, await repository.load(owner));
  await first.signProposal(proposalId);
  assert.equal((await repository.load(owner)).state.proposals[proposalId].state, "signed");
  let conflict;
  try { await stale.refreshOnChain(); } catch (error) { conflict = error; }
  const replay = new PraxisServerProvider(fixture.config, fixture.fake, await repository.load(owner));
  await replay.signProposal(proposalId);
  assert.equal(fixture.submissions(), 1, "an unrelated stale refresh reopened the proposal and paid twice");
  assert.ok(conflict instanceof PraxisConflictError, "stale writes must surface a conflict, not overwrite newer state");
  assert.equal((await repository.load(owner)).state.proposals[proposalId].state, "signed");
  resetStateRepositoryForTests();
});

test("stale writes cannot resurrect a cancelled schedule", async () => {
  const repository = isolatedRepository();
  resetStateRepositoryForTests(repository);
  const fixture = providerFixture();
  const owner = fixture.config.ownerAddress.toBase58();
  const state = stateWithProposal("local-terminal", owner);
  state.proposals["local-terminal"].state = "cancelled";
  state.schedules = [{ id: "local-schedule", nextFireTs: 1000 }];
  await repository.save(owner, state, 0);
  const stale = new PraxisServerProvider(fixture.config, fixture.fake, await repository.load(owner));
  const latest = await repository.load(owner);
  latest.state.schedules = [];
  await repository.save(owner, latest.state, latest.rev);
  await assert.rejects(stale.flushPersistence(), PraxisConflictError);
  assert.deepEqual((await repository.load(owner)).state.schedules, []);
  resetStateRepositoryForTests();
});

test("production refuses process-local nonce replay protection and incomplete Redis config", () => {
  const names = ["NODE_ENV", "REDIS_URL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"];
  const previous = names.map((name) => process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    process.env.NODE_ENV = "production";
    resetNonceStoreForTests();
    assert.throws(() => getNonceStore(), /shared Redis/);
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.invalid";
    resetNonceStoreForTests();
    assert.throws(() => getNonceStore(), /shared Redis/);
    process.env.UPSTASH_REDIS_REST_TOKEN = "local-test-token";
    resetNonceStoreForTests();
    assert.equal(getNonceStore().constructor.name, "RedisNonceStore");
    process.env.NODE_ENV = "development";
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetNonceStoreForTests();
    assert.ok(getNonceStore() instanceof MemoryNonceStore);
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
    resetNonceStoreForTests();
  }
});

test("two process-local nonce stores accept the same challenge independently", async () => {
  assert.equal(await new MemoryNonceStore().consume("local-signed-challenge", 300), true);
  assert.equal(await new MemoryNonceStore().consume("local-signed-challenge", 300), true);
});

test("signed challenge replay succeeds across replica-local stores, but not against one shared store", async () => {
  const wallet = Keypair.generate();
  const address = wallet.publicKey.toBase58();
  const request = new Request("https://praxis.local/api/praxis/auth/verify");
  const challenge = createWalletChallenge(address, request);
  const signature = bs58.encode(signEd25519(wallet, Buffer.from(challenge.message)));
  const args = { address, nonce: challenge.nonce, signature };
  try {
    resetNonceStoreForTests(new MemoryNonceStore());
    assert.equal(await verifyWalletChallenge(args, request), address);
    await assert.rejects(verifyWalletChallenge(args, request), /already used/);
    resetNonceStoreForTests(new MemoryNonceStore());
    assert.equal(await verifyWalletChallenge(args, request), address);
  } finally {
    resetNonceStoreForTests();
  }
});

test("the bounded signer still signs a valid message at exactly the body limit", async () => {
  const agent = Keypair.generate();
  const instruction = buildAgentTransferIx({
    programId: DEFAULT_AEGIS_PROGRAM_ID,
    policy: Keypair.generate().publicKey, vault: Keypair.generate().publicKey,
    actionLog: Keypair.generate().publicKey, agentAuthority: agent.publicKey,
  }, Keypair.generate().publicKey, 1n);
  const transaction = new Transaction({
    feePayer: agent.publicKey, blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1,
  }).add(instruction);
  const message = transaction.serializeMessage();
  const input = { message: message.toString("base64"), padding: "" };
  input.padding = " ".repeat(8192 - Buffer.byteLength(JSON.stringify(input)));
  const body = JSON.stringify(input);
  assert.equal(Buffer.byteLength(body), 8192);
  const handle = createSignerHandler({ keypair: agent, programId: DEFAULT_AEGIS_PROGRAM_ID, token: "local-token" });
  const response = await handle(new Request("http://signer.local/sign", {
    method: "POST", headers: { authorization: "Bearer local-token" }, body,
  }));
  assert.equal(response.status, 200);
  const result = await response.json();
  transaction.addSignature(agent.publicKey, Buffer.from(result.signature, "base64"));
  assert.equal(transaction.verifySignatures(), true);
});

test("authenticated signer stops consuming an oversized body and cancels its stream", async () => {
  const handle = createSignerHandler({ keypair: Keypair.generate(), programId: DEFAULT_AEGIS_PROGRAM_ID, token: "local-token" });
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      reads += 1;
      if (reads <= 3) controller.enqueue(new Uint8Array(4096).fill(32));
      else controller.error(new Error("consumed beyond local body budget"));
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const response = await handle(new Request("http://signer.local/sign", {
    method: "POST", headers: { authorization: "Bearer local-token" }, body, duplex: "half",
  }));
  assert.equal(response.status, 400);
  assert.equal(reads, 3);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("unexpected server errors do not expose internal messages or class names", async () => {
  const error = new Error("internal database host; synthetic-secret=not-a-real-secret");
  error.name = "InternalDatabaseDriverError";
  const response = jsonError(error);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "An unexpected server error occurred.", type: "Error", code: "internal_error",
  });
});

test("submitted transaction evidence survives error redaction", async () => {
  const error = new PraxisSubmittedError("local-signature");
  const response = jsonError(error);
  const body = await response.json();
  assert.equal(body.code, "submitted_unknown");
  assert.equal(body.error, error.message);
  assert.equal(body.details.sig, "local-signature");
});

test("API JSON body limits stop a stream even without Content-Length", async () => {
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      reads += 1;
      if (reads <= 2) controller.enqueue(new Uint8Array(40_000).fill(32));
      else controller.error(new Error("consumed beyond local API budget"));
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  await assert.rejects(readJson(new Request("http://api.local/test", { method: "POST", body, duplex: "half" })), /bytes or smaller/);
  assert.equal(reads, 2);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});
