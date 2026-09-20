import { withReadProvider } from "@/server/api/json";
import { resolveTokenCatalog } from "@/server/tokens/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The SPL mints this deployment can actually offer as a token envelope,
 * verified against the cluster it transfers on.
 *
 * Session-gated and read-only. The client used to ship its own hard-coded
 * mainnet list and offer it on devnet, where picking one cost a wallet
 * signature and returned a structural error. Which mints exist is a fact
 * about a cluster, so it is answered here.
 */
export async function GET(request: Request) {
  return withReadProvider(request, () => resolveTokenCatalog());
}
