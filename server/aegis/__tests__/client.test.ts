import { beforeEach, describe, expect, test } from "bun:test";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

import { AegisClient } from "../client";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  DEFAULT_AEGIS_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../constants";
import { findActionLogPda, findAssociatedTokenAddress, findPolicyPda, findVaultPda } from "../pdas";
import { buildClosePolicyIx } from "../instructions";
import { PraxisConfigError, PraxisInputError } from "../../errors";
import { DEFAULT_PRESTOCKS_API_URL, DEFAULT_PRESTOCKS_TIMEOUT_MS, DEFAULT_TOKENS, type PraxisServerConfig } from "../../env";
import type { AgentSigner } from "../../agent/agentSigner";
import { encodePolicyAccount, policyFixture } from "../../testing/fixtures";

const BLOCKHASH = Keypair.generate().publicKey.toBase58(); // valid 32-byte base58

// These tests construct PraxisServerConfig directly, so they must be hermetic:
// a populated .env (e.g. a configured next-agent key or remote signer) must not
// leak in through resolveNextAgentPublicKey / resolveAgentSigner.
beforeEach(() => {
  delete process.env.PRAXIS_NEXT_AGENT_PUBLIC_KEY;
  delete process.env.PRAXIS_AGENT_PUBLIC_KEY;
  delete process.env.PRAXIS_AGENT_SIGNER_URL;
});

/** A classic-SPL mint account (82-byte base; decimals at byte 44). */
function mintAccount(decimals = 6) {
  const data = Buffer.alloc(82);
  data[44] = decimals;
  return { data, owner: TOKEN_PROGRAM_ID, lamports: 1, executable: false };
}

/**
 * `getAccountInfo` that distinguishes the policy account from a mint. The
 * movability pre-check reads the mint, so a fake that returns the policy for
 * every address would make every configureToken look like a Token-2022 mint.
 */
function accountsFor(policyAddress: PublicKey, policyData: Buffer, mints: PublicKey[]) {
  const mintSet = new Set(mints.map((m) => m.toBase58()));
  return async (address: PublicKey) => {
    if (address.equals(policyAddress)) {
      return { data: policyData, owner: DEFAULT_AEGIS_PROGRAM_ID, lamports: 1, executable: false };
    }
    if (mintSet.has(address.toBase58())) return mintAccount();
    return { data: policyData, owner: DEFAULT_AEGIS_PROGRAM_ID, lamports: 1, executable: false };
  };
}

function fakeConnection(over: Partial<Record<string, unknown>> = {}): Connection {
  return {
    getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 321 }),
    sendRawTransaction: async () => "owner-sig",
    confirmTransaction: async () => ({ value: { err: null } }),
    ...over,
  } as unknown as Connection;
}

function serialize(tx: Transaction): string {
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

function makeConfig(over: Partial<PraxisServerConfig> = {}): PraxisServerConfig {
  const owner = Keypair.generate();
  const agent = Keypair.generate();
  const nextAgent = Keypair.generate();
  return {
    intentProviders: [],
    rpcUrl: "http://127.0.0.1:8899",
    researchRpcUrl: "http://127.0.0.1:8899",
    commitment: "confirmed",
    programId: DEFAULT_AEGIS_PROGRAM_ID,
    ownerAddress: owner.publicKey,
    agentKeypair: agent,
    nextAgentKeypair: nextAgent,
    policyAddress: findPolicyPda(owner.publicKey, DEFAULT_AEGIS_PROGRAM_ID),
    addressBook: [],
    tokens: DEFAULT_TOKENS,
    stocksEnabled: false,
    prestocksApiUrl: DEFAULT_PRESTOCKS_API_URL,
    prestocksTimeoutMs: DEFAULT_PRESTOCKS_TIMEOUT_MS,
    stockUniverse: undefined,
    stockDecimals: {},
    stockMints: {},
    scheduleHourUtc: 9,
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

  test("builds a bootstrap tx that initializes and funds the wallet policy", async () => {
    const config = makeConfig({ policyAddress: undefined });
    const wallet = config.ownerAddress!;
    const client = new AegisClient(config, fakeConnection({
      getAccountInfo: async () => null,
      getSlot: async () => 1,
      getBlockTime: async () => 1_700_000_000,
    }));

    const draft = await client.buildUnsignedOwnerTransaction(wallet, {
      kind: "bootstrapPolicy",
      fundLamports: 1_000_000_000n,
    });
    const tx = Transaction.from(Uint8Array.from(Buffer.from(draft.transaction, "base64")));

    expect(tx.feePayer?.equals(wallet)).toBe(true);
    expect(tx.instructions).toHaveLength(2);
    expect(tx.instructions.every((ix) => ix.programId.equals(DEFAULT_AEGIS_PROGRAM_ID))).toBe(true);
    expect(tx.instructions.every((ix) => ix.keys.some((key) => key.pubkey.equals(wallet) && key.isSigner))).toBe(true);
    expect(tx.signatures.every((s) => s.signature === null)).toBe(true);

    const embeddedAgent = new PublicKey(tx.instructions[0].data.subarray(8, 40));
    expect(embeddedAgent.equals(config.agentKeypair!.publicKey)).toBe(true);
    const fundedLamports = tx.instructions[1].data.readBigUInt64LE(8);
    expect(fundedLamports).toBe(1_000_000_000n);
  });

  test("bootstraps without a fund instruction when funding is omitted/zero", async () => {
    const config = makeConfig({ policyAddress: undefined });
    const wallet = config.ownerAddress!;
    const client = new AegisClient(config, fakeConnection({
      getAccountInfo: async () => null,
      getSlot: async () => 1,
      getBlockTime: async () => 1_700_000_000,
    }));

    const draft = await client.buildUnsignedOwnerTransaction(wallet, { kind: "bootstrapPolicy" });
    const tx = Transaction.from(Uint8Array.from(Buffer.from(draft.transaction, "base64")));

    // Just the initialize instruction — no vault funding.
    expect(tx.instructions).toHaveLength(1);
    expect(tx.feePayer?.equals(wallet)).toBe(true);
  });

  test("builds a standalone fundVault tx against the existing policy", async () => {
    const config = makeConfig();
    const wallet = config.ownerAddress!;
    const client = new AegisClient(config, fakeConnection());

    const draft = await client.buildUnsignedOwnerTransaction(wallet, {
      kind: "fundVault",
      amount: 250_000_000n,
    });
    const tx = Transaction.from(Uint8Array.from(Buffer.from(draft.transaction, "base64")));

    expect(tx.instructions).toHaveLength(1);
    expect(tx.feePayer?.equals(wallet)).toBe(true);
    expect(tx.instructions[0].keys.some((key) => key.pubkey.equals(wallet) && key.isSigner)).toBe(true);
    expect(tx.instructions[0].data.readBigUInt64LE(8)).toBe(250_000_000n);
  });

  test("builds a standalone withdrawVault tx against the existing policy", async () => {
    const config = makeConfig();
    const wallet = config.ownerAddress!;
    const client = new AegisClient(config, fakeConnection());

    const draft = await client.buildUnsignedOwnerTransaction(wallet, {
      kind: "withdrawVault",
      amount: 125_000_000n,
    });
    const tx = Transaction.from(Uint8Array.from(Buffer.from(draft.transaction, "base64")));

    expect(tx.instructions).toHaveLength(1);
    expect(tx.feePayer?.equals(wallet)).toBe(true);
    expect(tx.instructions[0].keys.some((key) => key.pubkey.equals(wallet) && key.isSigner)).toBe(true);
    expect(tx.instructions[0].data.readBigUInt64LE(8)).toBe(125_000_000n);
  });

  test("builds a closePolicy tx (owner + policy + action_log + vault)", async () => {
    const config = makeConfig();
    const wallet = config.ownerAddress!;
    // closePolicy reads the policy to enforce the SOL-only (no token balance)
    // guard; tokenMint=default means the envelope is unconfigured, so it passes.
    const policyData = encodePolicyAccount(
      policyFixture({
        address: config.policyAddress!.toBase58(),
        tokenMint: PublicKey.default.toBase58(),
      }),
    );
    const client = new AegisClient(config, fakeConnection({
      getAccountInfo: async () => ({ data: policyData, owner: DEFAULT_AEGIS_PROGRAM_ID, lamports: 1, executable: false }),
      getBalance: async () => 0,
    }));

    const draft = await client.buildUnsignedOwnerTransaction(wallet, { kind: "closePolicy" });
    const tx = Transaction.from(Uint8Array.from(Buffer.from(draft.transaction, "base64")));

    expect(tx.instructions).toHaveLength(1);
    expect(tx.feePayer?.equals(wallet)).toBe(true);
    // owner is the sole writable signer; 4 program accounts + system program.
    const ix = tx.instructions[0];
    expect(ix.keys[0].pubkey.equals(wallet)).toBe(true);
    expect(ix.keys[0].isSigner && ix.keys[0].isWritable).toBe(true);
    expect(ix.keys).toHaveLength(5);
    // no u64 arg — discriminator only.
    expect(ix.data).toHaveLength(8);
  });

  test("refuses to rotate to the current agent key", async () => {
    const agent = Keypair.generate();
    const config = makeConfig({ agentKeypair: agent, nextAgentKeypair: agent });
    const client = new AegisClient(config, fakeConnection());
    await expect(
      client.buildUnsignedOwnerTransaction(config.ownerAddress!, { kind: "rotate" }),
    ).rejects.toBeInstanceOf(PraxisConfigError);
  });

  test("builds configureToken with Aegis ix and vault ATA create when missing", async () => {
    const config = makeConfig();
    const wallet = config.ownerAddress!;
    const mint = Keypair.generate().publicKey;
    const policyData = encodePolicyAccount(
      policyFixture({ address: config.policyAddress!.toBase58() }),
    );
    const client = new AegisClient(
      config,
      fakeConnection({
        getAccountInfo: accountsFor(config.policyAddress!, policyData, [mint]),
        getBalance: async () => 0,
        // No existing ATAs — force a vault CreateIdempotent.
        getMultipleAccountsInfo: async () => [null],
      }),
    );

    const draft = await client.buildUnsignedOwnerTransaction(wallet, {
      kind: "configureToken",
      tokenMint: mint.toBase58(),
      tokenMaxPerTx: 100n,
      tokenDailyLimit: 1_000n,
    });
    const tx = Transaction.from(Uint8Array.from(Buffer.from(draft.transaction, "base64")));

    expect(tx.feePayer?.equals(wallet)).toBe(true);
    expect(tx.instructions.length).toBeGreaterThanOrEqual(1);
    expect(tx.instructions[0].programId.equals(DEFAULT_AEGIS_PROGRAM_ID)).toBe(true);
    // Vault ATA create is appended when the account is missing.
    expect(tx.instructions.some((ix) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID))).toBe(true);
    const vault = findVaultPda(config.policyAddress!, DEFAULT_AEGIS_PROGRAM_ID);
    expect(
      tx.instructions.some((ix) =>
        ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) &&
        ix.keys.some((key) => key.pubkey.equals(vault)),
      ),
    ).toBe(true);
    // So is the owner's own: a bare "buy $40 openai" settles there.
    expect(tx.instructions.some((ix) => isAtaCreateFor(ix, wallet))).toBe(true);
  });

  test("builds prepareTokenAccounts as ATA creates only", async () => {
    const config = makeConfig();
    const wallet = config.ownerAddress!;
    const mint = Keypair.generate().publicKey;
    const recipient = Keypair.generate().publicKey;
    const policyData = encodePolicyAccount(
      policyFixture({
        address: config.policyAddress!.toBase58(),
        tokenMint: mint.toBase58(),
      }),
    );
    const client = new AegisClient(
      config,
      fakeConnection({
        getAccountInfo: async () => ({
          data: policyData,
          owner: DEFAULT_AEGIS_PROGRAM_ID,
          lamports: 1,
          executable: false,
        }),
        getBalance: async () => 0,
        getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(() => null),
      }),
    );

    const draft = await client.buildUnsignedOwnerTransaction(wallet, {
      kind: "prepareTokenAccounts",
      recipientAddresses: [recipient.toBase58()],
    });
    const tx = Transaction.from(Uint8Array.from(Buffer.from(draft.transaction, "base64")));

    expect(tx.instructions.length).toBeGreaterThanOrEqual(1);
    expect(tx.instructions.every((ix) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID))).toBe(true);
    expect(tx.instructions.every((ix) => ix.data.length === 1 && ix.data[0] === 1)).toBe(true);
    // The owner's own account is prepared even though it is not in the list.
    expect(tx.instructions.some((ix) => isAtaCreateFor(ix, wallet))).toBe(true);
    expect(tx.instructions.some((ix) => isAtaCreateFor(ix, recipient))).toBe(true);
  });

  test("prepareTokenAccounts errors when every ATA already exists", async () => {
    const config = makeConfig();
    const mint = Keypair.generate().publicKey;
    const policyData = encodePolicyAccount(
      policyFixture({
        address: config.policyAddress!.toBase58(),
        tokenMint: mint.toBase58(),
      }),
    );
    const client = new AegisClient(
      config,
      fakeConnection({
        getAccountInfo: async () => ({
          data: policyData,
          owner: DEFAULT_AEGIS_PROGRAM_ID,
          lamports: 1,
          executable: false,
        }),
        getBalance: async () => 0,
        getMultipleAccountsInfo: async (keys: PublicKey[]) =>
          keys.map(() => ({ data: Buffer.alloc(0), owner: mint, lamports: 1, executable: false })),
      }),
    );

    await expect(
      client.buildUnsignedOwnerTransaction(config.ownerAddress!, {
        kind: "prepareTokenAccounts",
        recipientAddresses: [],
      }),
    ).rejects.toThrow(/already exist/);
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
  // A real, builder-produced owner draft (all-Aegis instructions) so it passes
  // the program-allowlist guard and exercises the confirm path.
  async function aegisOwnerDraft(config = makeConfig()) {
    const client = new AegisClient(config, fakeConnection());
    const draft = await client.buildUnsignedOwnerTransaction(config.ownerAddress!, { kind: "revoke" });
    return { config, draft };
  }

  test("returns the signature on a confirmed transaction", async () => {
    const { config, draft } = await aegisOwnerDraft();
    const client = new AegisClient(config, fakeConnection());
    expect(await client.submitSignedTransaction(draft, config.ownerAddress!)).toBe("owner-sig");
  });

  test("throws when the cluster reports an error", async () => {
    const { config, draft } = await aegisOwnerDraft();
    const client = new AegisClient(
      config,
      fakeConnection({ confirmTransaction: async () => ({ value: { err: { InstructionError: [0, "Custom"] } } }) }),
    );
    await expect(
      client.submitSignedTransaction(draft, config.ownerAddress!),
    ).rejects.toThrow(/owner transaction failed/);
  });

  test("rejects an unparseable transaction", async () => {
    const { config, draft } = await aegisOwnerDraft();
    const client = new AegisClient(config, fakeConnection());
    await expect(
      client.submitSignedTransaction({ ...draft, transaction: "AQID" }, config.ownerAddress!),
    ).rejects.toBeInstanceOf(PraxisInputError);
  });

  test("rejects a transaction whose fee payer is not the authenticated wallet", async () => {
    const { config, draft } = await aegisOwnerDraft();
    const client = new AegisClient(config, fakeConnection());
    await expect(
      client.submitSignedTransaction(draft, Keypair.generate().publicKey),
    ).rejects.toThrow(/fee payer does not match/);
  });

  test("rejects a transaction carrying a non-Aegis instruction (no open relay)", async () => {
    const { config, draft } = await aegisOwnerDraft();
    const wallet = config.ownerAddress!;
    // A wallet-signed raw SOL transfer — exactly what an attacker would try to
    // smuggle through the owner-submit relay, carrying a legitimately issued
    // draft token. It must be refused.
    const evil = new Transaction({ feePayer: wallet, blockhash: draft.blockhash, lastValidBlockHeight: 321 }).add(
      SystemProgram.transfer({ fromPubkey: wallet, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
    );
    const client = new AegisClient(config, fakeConnection());
    await expect(
      client.submitSignedTransaction({ ...draft, transaction: serialize(evil) }, wallet),
    ).rejects.toThrow(/Aegis|ATA CreateIdempotent/);
  });

  test("rejects Aegis instructions the backend did not build (draft mismatch)", async () => {
    // The gate's program allow-list alone would pass this: it IS an Aegis
    // instruction against the signer's own policy. But it is not the one the
    // backend produced, which is how a client would skip the server-side
    // preconditions attached to an action (a token-balance refusal on close,
    // a movable-mint check on configure).
    const { config, draft } = await aegisOwnerDraft();
    const wallet = config.ownerAddress!;
    const swapped = new Transaction({ feePayer: wallet, blockhash: draft.blockhash, lastValidBlockHeight: 321 }).add(
      buildClosePolicyIx({
        programId: config.programId,
        owner: wallet,
        policy: config.policyAddress!,
        vault: findVaultPda(config.policyAddress!, config.programId),
        actionLog: findActionLogPda(config.policyAddress!, config.programId),
      }),
    );
    const client = new AegisClient(config, fakeConnection());
    await expect(
      client.submitSignedTransaction({ ...draft, transaction: serialize(swapped) }, wallet),
    ).rejects.toThrow(/does not match the draft/);
  });

  test("rejects a draft token minted for another wallet", async () => {
    const { config, draft } = await aegisOwnerDraft();
    const other = await aegisOwnerDraft(makeConfig());
    const client = new AegisClient(config, fakeConnection());
    await expect(
      client.submitSignedTransaction({ ...draft, draft: other.draft.draft }, config.ownerAddress!),
    ).rejects.toThrow(/different wallet|does not match the draft/);
  });

  test("accepts wallet-appended ComputeBudget priority-fee instructions", async () => {
    // Wallets (e.g. Phantom) append SetComputeUnitLimit + SetComputeUnitPrice to
    // the unsigned draft on sign. Neither the program allow-list nor the draft
    // fingerprint may mistake those for tampering: they move no funds.
    const { config, draft } = await aegisOwnerDraft();
    const wallet = config.ownerAddress!;
    const withFees = Transaction.from(Uint8Array.from(Buffer.from(draft.transaction, "base64")));
    withFees.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
    );
    const client = new AegisClient(config, fakeConnection());
    await expect(
      client.submitSignedTransaction({ ...draft, transaction: serialize(withFees) }, wallet),
    ).resolves.toBe("owner-sig");
  });

  test("still rejects a ComputeBudget-shaped disguise on another program", async () => {
    const { config, draft } = await aegisOwnerDraft();
    const wallet = config.ownerAddress!;
    // Right shape, wrong program: a muted SystemProgram transfer must not pass
    // just because it is small.
    const evil = new Transaction({ feePayer: wallet, blockhash: draft.blockhash, lastValidBlockHeight: 321 }).add(
      SystemProgram.transfer({ fromPubkey: wallet, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
    );
    const client = new AegisClient(config, fakeConnection());
    await expect(
      client.submitSignedTransaction({ ...draft, transaction: serialize(evil) }, wallet),
    ).rejects.toThrow(/blocked program 11111111111111111111111111111111/);
  });

  test("configures an envelope for a Token-2022 mint, with a Token-2022 ATA", async () => {
    // Tokenized stocks are Token-2022; this is the path that makes a stock
    // envelope usable at all. The ATA seeds include the token program id, so
    // the create must reference Token-2022 or it lands at an address that
    // will never hold the tokens.
    const config = makeConfig();
    const mint = Keypair.generate().publicKey;
    const policyData = encodePolicyAccount(policyFixture({ address: config.policyAddress!.toBase58() }));
    const token2022Mint = Buffer.alloc(902);
    token2022Mint[44] = 9;
    token2022Mint[45] = 1;
    const client = new AegisClient(
      config,
      fakeConnection({
        getAccountInfo: async (address: PublicKey) =>
          address.equals(mint)
            ? { data: token2022Mint, owner: TOKEN_2022_PROGRAM_ID, lamports: 1, executable: false }
            : { data: policyData, owner: DEFAULT_AEGIS_PROGRAM_ID, lamports: 1, executable: false },
        getBalance: async () => 0,
        getMultipleAccountsInfo: async () => [null],
      }),
    );
    const draft = await client.buildUnsignedOwnerTransaction(config.ownerAddress!, {
      kind: "configureToken",
      tokenMint: mint.toBase58(),
      tokenMaxPerTx: 10n,
      tokenDailyLimit: 100n,
    });
    const tx = Transaction.from(Uint8Array.from(Buffer.from(draft.transaction, "base64")));
    const ata = tx.instructions.find((ix) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
    expect(ata).toBeDefined();
    expect(ata!.keys.some((k) => k.pubkey.equals(TOKEN_2022_PROGRAM_ID))).toBe(true);

    const vault = findVaultPda(config.policyAddress!, DEFAULT_AEGIS_PROGRAM_ID);
    const expected = findAssociatedTokenAddress(vault, mint, TOKEN_2022_PROGRAM_ID);
    expect(ata!.keys.some((k) => k.pubkey.equals(expected))).toBe(true);
  });

  test("refuses an envelope for a mint under an unknown token program", async () => {
    const config = makeConfig();
    const mint = Keypair.generate().publicKey;
    const policyData = encodePolicyAccount(policyFixture({ address: config.policyAddress!.toBase58() }));
    const alien = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
    const client = new AegisClient(
      config,
      fakeConnection({
        getAccountInfo: async (address: PublicKey) =>
          address.equals(mint)
            ? { data: Buffer.alloc(82), owner: alien, lamports: 1, executable: false }
            : { data: policyData, owner: DEFAULT_AEGIS_PROGRAM_ID, lamports: 1, executable: false },
        getBalance: async () => 0,
        getMultipleAccountsInfo: async () => [null],
      }),
    );
    await expect(
      client.buildUnsignedOwnerTransaction(config.ownerAddress!, {
        kind: "configureToken",
        tokenMint: mint.toBase58(),
        tokenMaxPerTx: 10n,
        tokenDailyLimit: 100n,
      }),
    ).rejects.toThrow(/neither SPL Token nor Token-2022/);
  });

  test("accepts a builder-produced configureToken draft that includes an ATA create", async () => {
    const config = makeConfig();
    const mint = Keypair.generate().publicKey;
    const policyData = encodePolicyAccount(
      policyFixture({ address: config.policyAddress!.toBase58() }),
    );
    const conn = fakeConnection({
      getAccountInfo: accountsFor(config.policyAddress!, policyData, [mint]),
      getBalance: async () => 0,
      getMultipleAccountsInfo: async () => [null],
    });
    const client = new AegisClient(config, conn);
    const draft = await client.buildUnsignedOwnerTransaction(config.ownerAddress!, {
      kind: "configureToken",
      tokenMint: mint.toBase58(),
      tokenMaxPerTx: 10n,
      tokenDailyLimit: 100n,
    });
    expect(await client.submitSignedTransaction(draft, config.ownerAddress!)).toBe("owner-sig");
  });
});

/** An associated-token-account create whose owning wallet (key 2) is `owner`. */
function isAtaCreateFor(ix: TransactionInstruction, owner: PublicKey): boolean {
  return ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) && ix.keys[2]?.pubkey.equals(owner);
}

describe("getVaultTokenBalance", () => {
  /** A Token-2022 token account (165-byte base layout) holding `amount`. */
  function tokenAccount(amount: bigint) {
    const data = Buffer.alloc(170);
    data.writeBigUInt64LE(amount, 64);
    return { data, owner: TOKEN_2022_PROGRAM_ID, lamports: 1, executable: false };
  }

  /** A client whose chain holds one Token-2022 mint and, optionally, the vault's account for it. */
  function setup(vaultAccount: ReturnType<typeof tokenAccount> | { data: Buffer } | null, mintReadable = true) {
    const config = makeConfig();
    const mint = Keypair.generate().publicKey;
    const policy = policyFixture({ address: config.policyAddress!.toBase58(), tokenMint: mint.toBase58() });
    const vault = findVaultPda(config.policyAddress!, DEFAULT_AEGIS_PROGRAM_ID);
    const ata = findAssociatedTokenAddress(vault, mint, TOKEN_2022_PROGRAM_ID);
    const mintData = Buffer.alloc(82);
    mintData[44] = 9;
    const client = new AegisClient(
      config,
      fakeConnection({
        getAccountInfo: async (address: PublicKey) => {
          if (address.equals(mint)) {
            return mintReadable ? { data: mintData, owner: TOKEN_2022_PROGRAM_ID, lamports: 1, executable: false } : null;
          }
          return address.equals(ata) ? vaultAccount : null;
        },
      }),
    );
    return { client, policy };
  }

  test("reads the vault's Token-2022 ATA", async () => {
    const { client, policy } = setup(tokenAccount(1_000_000_000_000n));
    expect(await client.getVaultTokenBalance(policy)).toBe(1_000_000_000_000n);
  });

  test("a vault token account that was never created holds zero", async () => {
    const { client, policy } = setup(null);
    expect(await client.getVaultTokenBalance(policy)).toBe(0n);
  });

  test("is unknown, not zero, when the mint can't be read", async () => {
    // Guessing classic SPL would derive an ATA that doesn't exist and read 0.
    const { client, policy } = setup(tokenAccount(5n), false);
    expect(await client.getVaultTokenBalance(policy)).toBeUndefined();
  });

  test("is unknown for an account too short to be a token account", async () => {
    const { client, policy } = setup({ data: Buffer.alloc(72) });
    expect(await client.getVaultTokenBalance(policy)).toBeUndefined();
  });

  test("is unknown with no envelope configured, without touching the chain", async () => {
    const config = makeConfig();
    const client = new AegisClient(
      config,
      fakeConnection({
        getAccountInfo: async () => {
          throw new Error("must not read");
        },
      }),
    );
    const policy = policyFixture({ address: config.policyAddress!.toBase58(), tokenMint: PublicKey.default.toBase58() });
    expect(await client.getVaultTokenBalance(policy)).toBeUndefined();
  });
});
