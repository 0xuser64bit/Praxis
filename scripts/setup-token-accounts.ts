import { PublicKey } from "@solana/web3.js";

import { AegisClient } from "../server/aegis/client";
import { getServerConfig, resetConfigForTests } from "../server/env";
import { parseHumanUnits } from "../server/units";

async function main() {
  resetConfigForTests();
  const config = getServerConfig();
  const client = new AegisClient(config);
  const policy = await client.getPolicy();
  const token = config.tokens.find((item) => item.mint === policy.tokenMint);
  if (!token) {
    throw new Error(`Configured token mint is not in PRAXIS_TOKENS: ${policy.tokenMint}`);
  }

  const recipients = config.addressBook.map((entry) => new PublicKey(entry.address));
  const setup = await client.ensureConfiguredTokenAccounts(recipients);
  console.log(`mint=${token.symbol} ${setup.mint}`);
  console.log(`vaultAta=${setup.vaultTokenAccount}`);
  console.log(`recipientAtas=${setup.recipientTokenAccounts.length}`);
  console.log(`created=${setup.created.length} existing=${setup.existing.length} sig=${setup.sig ?? "none"}`);

  const fundAmount = process.env.PRAXIS_TOKEN_VAULT_FUND_AMOUNT?.trim();
  if (fundAmount) {
    const amount = parseHumanUnits(fundAmount, token.decimals);
    const sig = await client.fundTokenVault(token.mint, amount);
    console.log(`funded=${fundAmount} ${token.symbol} sig=${sig}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
