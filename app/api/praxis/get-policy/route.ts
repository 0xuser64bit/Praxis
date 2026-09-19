import { PublicKey } from "@solana/web3.js";

import { readString, withReadProvider } from "@/server/api/json";
import { PraxisInputError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withReadProvider(request, (provider) => {
    // Stocklana C05: optional view selector for the active-stock switcher.
    // Derivation is intentionally identical with or without `mint`: the policy
    // PDA is `[policy, owner]` — one policy per wallet, one SPL envelope at a
    // time. `mint` selects the *view* (the client labels "OPENAI vault · 6 of
    // 8"); it never changes which account is read. Validated so garbage never
    // reaches the derivation path.
    const raw = new URL(request.url).searchParams.get("mint");
    if (raw !== null) {
      const mint = readString(raw, "mint", { maxLength: 64 });
      try {
        new PublicKey(mint);
      } catch {
        throw new PraxisInputError("mint must be a valid Solana address");
      }
    }
    return provider.refreshPolicy();
  });
}
