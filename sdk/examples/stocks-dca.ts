/**
 * Guarded stock buys: drive a hosted Praxis agent for PreStocks from Node.
 *
 *   PRAXIS_URL=https://your-praxis.app \
 *   PRAXIS_SECRET_KEY=<base58 secret key> \
 *   bun examples/stocks-dca.ts "buy $40 openai"
 *
 * Flow: universe → research → ask → sign only what Aegis allows. Every
 * proposal prints ALLOWED (signed) or BLOCKED (left untouched) with the
 * on-chain reason. Nothing is ever signed blindly: the loop signs strictly
 * `check.allowed` proposals, and Aegis re-enforces caps on-chain anyway.
 */
import { PraxisClient, keypairSigner, baseUnitsToHuman } from "../src/index";

const baseUrl = process.env.PRAXIS_URL ?? "http://localhost:3000";
const secret = process.env.PRAXIS_SECRET_KEY;
const prompt = process.argv[2] ?? "buy $40 openai";

if (!secret) throw new Error("Set PRAXIS_SECRET_KEY to a base58-encoded Solana secret key.");

const praxis = new PraxisClient({ baseUrl, signer: keypairSigner(secret) });

await praxis.connect();
console.log(`signed in as ${praxis.address}\n`);

const universe = await praxis.getTokenUniverse();
if (universe.length === 0) {
  console.log("Stock universe is empty — the server runs with PRAXIS_STOCKS_ENABLED=0.");
  process.exit(1);
}
console.log(`universe: ${universe.map((s) => s.symbol).join(", ")}\n`);

const { proposals } = await praxis.ask(prompt);
if (proposals.length === 0) {
  console.log("No proposals — the agent clarified or declined. Run with research first:");
  console.log(`  bun examples/stocks-dca.ts "research openai"`);
  process.exit(0);
}

for (const p of proposals) {
  const what = p.detail.kind === "transfer"
    ? `${baseUnitsToHuman(p.detail.amount, p.detail.asset.decimals)} ${p.detail.asset.symbol} → ${p.detail.recipientName}`
    : `${p.detail.kind} proposal`;
  if (p.check.allowed) {
    await praxis.signProposal(p.id);
    console.log(`ALLOWED  ${what}  — signed (Aegis enforces caps on-chain)`);
  } else {
    console.log(`BLOCKED  ${what}  — ${p.check.reason ?? "policy"}`);
  }
}
