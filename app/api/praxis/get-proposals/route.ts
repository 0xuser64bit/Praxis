import { withReadProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Batch read of every proposal the wallet holds. Replaces the client's
 * per-proposal N+1 fetch on refresh; the persisted proposal set is already
 * bounded by orphan GC (only proposals referenced by retained threads survive).
 */
export async function GET(request: Request) {
  return withReadProvider(request, (provider) => provider.getAllProposals());
}
