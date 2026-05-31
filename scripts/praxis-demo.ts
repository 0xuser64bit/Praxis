import { PublicKey } from "@solana/web3.js";
import { RejectReason } from "@praxis/shared";

import { AegisClient } from "../server/aegis/client";
import {
  JUPITER_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../server/aegis/constants";
import { AddressBook } from "../server/agent/addressBook";
import { parseIntentLocallyForDemo, parseIntentWithGemini, type ParsedAction } from "../server/agent/intent";
import { checkTransferPolicy } from "../server/agent/policy";
import {
  getServerConfig,
  requireAgentKeypair,
  requireOwnerKeypair,
  resetConfigForTests,
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

function resolve(book: AddressBook, recipient: string): PublicKey {
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
