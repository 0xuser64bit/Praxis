import { withMutationProvider } from "@/server/api/json";
import { assertRateLimit } from "@/server/api/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Devnet demo only: mint demo stock into the signed-in wallet's vault. */
export async function POST(request: Request) {
  return withMutationProvider(request, async (provider, session) => {
    // Each grant costs the faucet key rent and fees, so it is metered per wallet.
    await assertRateLimit(request, {
      scope: "demo-faucet",
      identity: session.walletAddress,
      limit: 3,
      windowMs: 86_400_000,
    });
    return provider.mintDemoStock();
  });
}
