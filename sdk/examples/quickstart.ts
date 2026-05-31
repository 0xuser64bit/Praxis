/**
 * Quickstart: drive a hosted Praxis agent from Node.
 *
 *   PRAXIS_URL=https://your-praxis.app \
 *   PRAXIS_SECRET_KEY=<base58 secret key> \
 *   bun examples/quickstart.ts "send 0.5 SOL to maya"
 *
 * The secret key signs the sign-in challenge AND is the wallet whose Aegis
 * policy governs the agent. It never leaves this process; only a base58
 * signature is sent to the server.
 */
import { PraxisClient, keypairSigner, baseUnitsToHuman } from "../src/index";

const baseUrl = process.env.PRAXIS_URL ?? "http://localhost:3000";
const secret = process.env.PRAXIS_SECRET_KEY;
const prompt = process.argv[2] ?? "send 0.5 SOL to maya";

if (!secret) throw new Error("Set PRAXIS_SECRET_KEY to a base58-encoded Solana secret key.");

const praxis = new PraxisClient({ baseUrl, signer: keypairSigner(secret) });

await praxis.connect();
console.log(`signed in as ${praxis.address}\n`);

const { message, proposals } = await praxis.ask(prompt);

for (const block of message.blocks) {
  if (block.type === "prose") console.log(block.text);
  if (block.type === "clarify") console.log(`❓ ${block.text}`, block.options.map((o) => o.label));
  if (block.type === "research") {
    console.log(`📊 ${block.data.token}`);
    for (const m of block.data.metrics) console.log(`   ${m.label}: ${m.value}`);
  }
}

for (const p of proposals) {
  if (p.detail.kind === "transfer") {
    const human = baseUnitsToHuman(p.detail.amount, p.detail.asset.decimals);
    console.log(`\n→ Transfer ${human} ${p.detail.asset.symbol} to ${p.detail.recipientName}`);
  }
  console.log(`  Aegis: ${p.check.allowed ? "ALLOWED" : `BLOCKED — ${p.check.reason}`}`);

  if (p.check.allowed) {
    await praxis.signProposal(p.id);
    const signed = await praxis.getProposal(p.id);
    console.log(`  ${signed.state}${signed.sig ? ` (${signed.sig})` : ""}`);
  }
}
