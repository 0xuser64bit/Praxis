import { PublicKey } from "@solana/web3.js";
import { RejectReason } from "@praxis/shared";

import { AegisClient, getResearchConnection } from "../server/aegis/client";
import {
  JUPITER_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../server/aegis/constants";
import { AddressBook } from "../server/agent/addressBook";
import { parseIntentLocallyForDemo, parseIntentWithGemini, type ParsedAction } from "../server/agent/intent";
import { checkTransferPolicy } from "../server/agent/policy";
import { researchToken } from "../server/agent/research";
import {
  getServerConfig,
  requireAgentKeypair,
  requireOwnerKeypair,
  resetConfigForTests,
  type PraxisServerConfig,
} from "../server/env";
import { PraxisNotFoundError } from "../server/errors";
import { formatSol, parseHumanUnits, SOL_DECIMALS } from "../server/units";

const ALLOWED_LINE = process.env.PRAXIS_DEMO_ALLOWED_LINE ?? "send 0.5 sol to maya";
const OVER_CAP_LINE = process.env.PRAXIS_DEMO_OVER_CAP_LINE ?? "send 50 sol to maya";

async function main() {
  resetConfigForTests();
  const config = getServerConfig();
  const client = new AegisClient(config);
  const book = new AddressBook(config.addressBook);

  if (process.argv.includes("--stocks")) {
    await stocksMode(client, config);
    return;
  }

  await ensureDemoPolicy(client);
  await ensureDemoTokenAccounts(client, config);

  const allowed = await parseTransfer(ALLOWED_LINE, config);
  const allowedRecipient = resolve(book, allowed.recipient);
  const allowedAmount = parseHumanUnits(allowed.amountHuman, SOL_DECIMALS);
  const allowedPreview = await client.simulateAgentTransfer(allowedRecipient, allowedAmount);

  printPreview("ALLOWED PREVIEW", ALLOWED_LINE, allowedPreview.check);
  if (!allowedPreview.check.allowed) {
    throw new Error(`Expected allowed preview, got: ${allowedPreview.check.reason}`);
  }

  const allowedExec = await client.executeAgentTransfer(allowedRecipient, allowedAmount);
  console.log(
    `ALLOWED EXECUTION: ${allowedExec.status} sig=${allowedExec.sig ?? "none"} amount=${formatSol(allowedAmount)} SOL`,
  );

  const over = await parseTransfer(OVER_CAP_LINE, config);
  const overRecipient = resolve(book, over.recipient);
  const overAmount = parseHumanUnits(over.amountHuman, SOL_DECIMALS);
  const overPreview = await client.simulateAgentTransfer(overRecipient, overAmount);
  printPreview("OVER-CAP PREVIEW", OVER_CAP_LINE, overPreview.check);

  const overExec = await client.executeAgentTransfer(overRecipient, overAmount, {
    skipPreflight: true,
  });
  printPreview("OVER-CAP PROGRAM RESULT", OVER_CAP_LINE, overExec.check, overExec.sig);
}

/**
 * Stocklana C08 --stocks mode: research → buy 40 OPENAI (honest verdict) →
 * over-cap 500 OPENAI (always blocked) → pause → resume. Needs the demo keys +
 * cluster like the SOL flow, plus PRAXIS_STOCKS_ENABLED=1. Moves no value:
 * the 40-OPENAI leg only simulates; pause/resume are the only submitted txs.
 */
async function stocksMode(client: AegisClient, config: PraxisServerConfig) {
  console.log("STOCKS DEMO: research → buy 40 OPENAI → over-cap 500 OPENAI block → pause → resume");
  await ensureDemoPolicy(client);

  const openai = config.tokens.find((t) => t.symbol === "OPENAI");
  if (!openai) throw new Error("OPENAI not configured — run with PRAXIS_STOCKS_ENABLED=1.");
  await client.configureToken({
    tokenMint: openai.mint,
    tokenMaxPerTx: parseHumanUnits("200", openai.decimals),
    tokenDailyLimit: parseHumanUnits("500", openai.decimals),
  });
  await client.ensureConfiguredTokenAccounts(
    config.addressBook.map((entry) => new PublicKey(entry.address)),
  );
  console.log(`ENVELOPE: OPENAI 200/tx, 500/day`);

  const data = await researchToken(
    { kind: "resolved", token: openai, via: "catalog", alternatives: [] },
    getResearchConnection(config),
    config,
  );
  console.log(`RESEARCH: ${data.token} — ${data.summary}`);

  const owner = config.ownerAddress ?? requireOwnerKeypair().publicKey;
  const buy = await client.simulateAgentTransferSpl(
    owner,
    openai,
    parseHumanUnits("40", openai.decimals),
  );
  console.log(
    `BUY 40 OPENAI: allowed=${buy.check.allowed}` +
      (buy.check.reason ? ` reason=${buy.check.reason}` : "") +
      " (honest verdict: needs a funded token vault to pass)",
  );

  const over = await client.simulateAgentTransferSpl(
    owner,
    openai,
    parseHumanUnits("500", openai.decimals),
  );
  console.log(`OVER-CAP 500 OPENAI: allowed=${over.check.allowed} reason=${over.check.reason ?? "none"}`);
  if (over.check.allowed) throw new Error("Expected the 500 OPENAI buy to be blocked by the 200/tx cap.");

  await client.updatePolicy({ paused: true });
  if (!(await client.getPolicy()).paused) throw new Error("Pause did not take effect.");
  console.log("PAUSED: agent transfers now fail closed");
  await client.updatePolicy({ paused: false });
  if ((await client.getPolicy()).paused) throw new Error("Resume did not take effect.");
  console.log("RESUMED: agent transfers allowed again");
  console.log("STOCKS DEMO: PASS ✅ (no value moved)");
}

async function ensureDemoPolicy(client: AegisClient) {
  try {
    await client.getPolicy();
    return;
  } catch (error) {
    if (!(error instanceof PraxisNotFoundError)) throw error;
  }

  requireOwnerKeypair();
  requireAgentKeypair();
  const now = Math.floor(Date.now() / 1000);
  // Seed the allow-lists to match the mock so the §9 #3 money-shot is faithful:
  // Jupiter must be allow-listed for the swap's PROGRAM check to pass, so the
  // unverified MINT is what rejects ("mint not in the verified set").
  const config = getServerConfig();
  const verifiedMints = config.tokens.filter((token) => token.verified).map((token) => token.mint);
  await client.initializePolicy({
    maxPerTx: parseHumanUnits("50", SOL_DECIMALS),
    dailyLimit: parseHumanUnits("5", SOL_DECIMALS),
    allowedPrograms: [
      SYSTEM_PROGRAM_ID.toBase58(),
      TOKEN_PROGRAM_ID.toBase58(),
      JUPITER_PROGRAM_ID.toBase58(),
    ],
    allowedRecipients: [],
    allowedMints: verifiedMints,
    expiryTs: now + 7 * 86_400,
  });
  await client.fundVault(parseHumanUnits("1", SOL_DECIMALS));

  // Configure the SPL-token envelope (USDC) so API mode mirrors the mock seed:
  // the agent can move USDC within its OWN caps via agent_transfer_spl.
  const usdc = config.tokens.find((token) => token.symbol === "USDC");
  if (usdc) {
    await client.configureToken({
      tokenMint: usdc.mint,
      tokenMaxPerTx: parseHumanUnits("200", usdc.decimals),
      tokenDailyLimit: parseHumanUnits("500", usdc.decimals),
    });
  }
}

async function ensureDemoTokenAccounts(client: AegisClient, config = getServerConfig()) {
  const policy = await client.getPolicy();
  if (policy.tokenMint === PublicKey.default.toBase58()) return;
  await client.ensureConfiguredTokenAccounts(
    config.addressBook.map((entry) => new PublicKey(entry.address)),
  );
}

async function parseTransfer(line: string, config = getServerConfig()): Promise<Extract<ParsedAction, { kind: "transfer" }>> {
  let parsed;
  if (process.env.PRAXIS_DEMO_USE_LLM === "1") {
    parsed = await parseIntentWithGemini(line, config);
  } else {
    parsed = parseIntentLocallyForDemo(line);
  }
  if (parsed.outcome !== "actions") {
    throw new Error(`Expected transfer intent for "${line}", got ${parsed.outcome}`);
  }
  const transfer = parsed.actions.find((action): action is Extract<ParsedAction, { kind: "transfer" }> => {
    return action.kind === "transfer";
  });
  if (!transfer) throw new Error(`No transfer action parsed for "${line}"`);
  return transfer;
}

function resolve(book: AddressBook, recipient: string | undefined): PublicKey {
  // The demo's lines always name a recipient (a bare buy, which may omit one,
  // has no place in a SOL send/over-cap demo). Say so out loud rather than
  // asserting it away, so an overridden PRAXIS_DEMO_*_LINE fails here with a
  // readable message instead of somewhere downstream.
  if (!recipient) {
    throw new Error("This demo line must name a recipient, e.g. \"send 0.5 sol to maya\".");
  }
  const resolved = book.resolve(recipient);
  if (resolved.kind !== "exact") throw new Error(resolved.question);
  return new PublicKey(resolved.entry.address);
}

function printPreview(
  label: string,
  line: string,
  check: ReturnType<typeof checkTransferPolicy>,
  sig?: string,
) {
  const code = check.reasonCode === undefined ? "none" : RejectReason[check.reasonCode];
  console.log(
    `${label}: "${line}" allowed=${check.allowed} reasonCode=${code} remaining=${formatSol(check.remaining)} SOL${sig ? ` sig=${sig}` : ""}`,
  );
  if (check.reason) console.log(`${label} REASON: ${check.reason}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
