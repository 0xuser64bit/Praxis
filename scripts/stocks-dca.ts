/**
 * DCA schedule inspector + manual fire.
 *
 *   bun scripts/stocks-dca.ts --list   # print schedules for the owner wallet
 *   bun scripts/stocks-dca.ts --fire    # fire due schedules (emits proposals, never signs)
 *
 * Server-side like praxis-demo.ts: loads the owner wallet's provider from the
 * configured state backend and calls fireDueSchedules directly (no HTTP auth).
 * Firing simulates through Aegis on the configured cluster — needs RPC access
 * but moves no value (proposals only; every fire still needs a signature).
 */

import { PublicKey } from "@solana/web3.js";

import { getPraxisServerProvider } from "../server/provider/praxisServer";
import { configForWalletOwner, getServerConfig, resetConfigForTests } from "../server/env";
import { describeCadence } from "../server/stocks/schedules";
import { formatUnits } from "../server/units";

const mode = process.argv.includes("--fire") ? "fire" : "list";

async function main() {
  resetConfigForTests();
  const base = getServerConfig();
  const owner = base.ownerAddress;
  if (!owner) {
    console.log("No owner wallet configured (AEGIS_OWNER_ADDRESS or PRAXIS_OWNER_KEYPAIR). Nothing to do.");
    process.exit(1);
  }
  const config = configForWalletOwner(new PublicKey(owner.toBase58()));
  const provider = await getPraxisServerProvider(config.ownerAddress!.toBase58());
  const schedules = provider.getSchedules();

  console.log("┌──── STOCKS DCA (C06) ───────────────────────────────────────────────");
  console.log(`│ wallet: ${owner.toBase58()}`);
  console.log(`│ schedules: ${schedules.length}`);
  for (const s of schedules) {
    const due = s.nextFireTs <= Date.now() ? "DUE" : "waiting";
    console.log(
      `│   ${due} ${s.id}  ${formatUnits(s.amount, s.decimals)} ${s.asset} ${describeCadence(s.cadence)} → ${s.recipientName}  next=${new Date(s.nextFireTs).toISOString()}`,
    );
  }

  if (mode === "fire") {
    const fired = await provider.fireDueSchedules(Date.now());
    console.log(`│ fired: ${fired.length}`);
    for (const f of fired) {
      console.log(`│   ✓ schedule=${f.scheduleId} proposal=${f.proposalId} allowed=${f.allowed}`);
    }
    console.log("│ proposals only — nothing was signed.");
  } else {
    console.log("│ (dry run: pass --fire to emit proposals for due schedules)");
  }
  console.log("└─────────────────────────────────────────────────────────────────────");
}

void main();
